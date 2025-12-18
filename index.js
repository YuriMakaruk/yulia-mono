const express = require('express');
const app = express();
const fetch = require('node-fetch'); // Ensure node-fetch is installed

app.use(express.json());

const MONOBANK_TOKEN = process.env.MONOBANK_BOT_TOKEN; // Your Monobank token
const chatId = process.env.CHAT_ID; // The chat ID of the recipient
const telegramToken = process.env.TELEGRAM_BOT_TOKEN; // Your bot's token obtained from BotFather on Telegram
const MONOBANK_WEBHOOK_URL = process.env.MONOBANK_WEBHOOK_URL || 'https://yulia-mono.onrender.com/webhook';

// Construct the Telegram API URL for sending a message
const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;

// Your custom function that does a calculation
async function performFunction() {
    try {
        const account = process.env.ALLOWED_ACCOUNT;
        const fromDate = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000); // Start of today
        const toDate = Math.floor(new Date().getTime() / 1000); // Current date
        const monobankUrl = `https://api.monobank.ua/personal/statement/${account}/${fromDate}/${toDate}`;

        const response = await fetch(monobankUrl, {
            method: 'GET',
            headers: {
                'X-Token': MONOBANK_TOKEN
            }
        });

        if (!response.ok) {
            throw new Error(`Error fetching Monobank data: ${response.status} ${response.statusText}`);
        }

        const transactions = await response.json();

        // Variables for accumulating transaction data
        let total = 0;
        let transactionDetails = [];
        const localTime = new Date().toLocaleTimeString('en-US', {
            timeZone: 'Europe/Kiev', // Set the time zone
            hour12: false // Optional: use 24-hour format (set to true for 12-hour format)
        });

        transactions.forEach(item => {
            const amountUAH = item.amount / 100; // Convert the amount to UAH

            // Only process negative amounts (expenses)
            if (item.amount < 0) {
                console.log(`Transaction description: ${item.description}, Amount: ${amountUAH} UAH`);

                // Sum the negative amounts
                total += item.amount;

                // Accumulate descriptions and amounts
                if (item.description) {
                    transactionDetails.push(`${item.description}: ${amountUAH.toFixed(2)} UAH`);
                }
            }
        });

        const totalUAH = total / 100; // Convert total to UAH
        console.log('Total amount from all transactions today:', totalUAH.toFixed(2), 'UAH');

        // Prepare the detailed transaction list for Telegram message
        const transactionText = transactionDetails.length > 0 ? transactionDetails.join('\n') : 'No transactions found.';

        // Send Telegram message
        const telegramResponse = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: `Today's total expenses are ${totalUAH.toFixed(2)} UAH. 
Date and time: ${localTime}. 
Transaction details: ${transactionText}`
            })
        });

        const data = await telegramResponse.json();
        if (data.ok) {
            console.log('Message sent:', data.result.text);
        } else {
            console.error('Telegram API Error:', data.description);
        }

    } catch (error) {
        console.error('Error fetching Monobank data:', error.message);
    }
}

let isProcessing = false;

app.post('/webhook', async (req, res) => {
    if (isProcessing) {
        console.log('Already processing, ignoring duplicate webhook');
        return res.sendStatus(200);
    }

    isProcessing = true;
    console.log('Received webhook:', req.body);

    await performFunction(); // Call your async function
    isProcessing = false; // Reset flag after processing
    res.sendStatus(200);
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// 1. Send Unfreeze button on /unfreeze command
app.post(`/telegram`, async (req, res) => {
    const body = req.body;
    // Handle /unfreeze command
    if (body.message && body.message.text === '/unfreeze') {
        await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: body.message.chat.id,
                text: 'Click the button below to unfreeze Monobank webhook:',
                reply_markup: {
                    inline_keyboard: [[
                        { text: 'Unfreeze', callback_data: 'unfreeze_webhook' }
                    ]]
                }
            })
        });
        return res.sendStatus(200);
    }
    // Handle callback query from button
    if (body.callback_query && body.callback_query.data === 'unfreeze_webhook') {
        // 2. Send Monobank webhook registration request
        const monobankResponse = await fetch('https://api.monobank.ua/personal/webhook', {
            method: 'POST',
            headers: {
                'X-Token': MONOBANK_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ webHookUrl: MONOBANK_WEBHOOK_URL })
        });
        let resultText = 'Webhook registration failed.';
        if (monobankResponse.ok) {
            resultText = 'Webhook successfully registered!';
        }
        // Answer callback query
        await fetch(`https://api.telegram.org/bot${telegramToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callback_query_id: body.callback_query.id,
                text: resultText,
                show_alert: true
            })
        });
        // Optionally send a message to chat
        await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: body.callback_query.message.chat.id,
                text: resultText
            })
        });
        return res.sendStatus(200);
    }
    res.sendStatus(200);
});

