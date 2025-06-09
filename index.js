const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();
const { ServerClient } = require('postmark');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const { nanoid } = require('nanoid');

const app = express();
const postmarkClient = new ServerClient(process.env.POSTMARK_API_KEY);

const file = path.join(__dirname, 'emails.json');
const adapter = new JSONFile(file);

// Pass default data as second argument
const db = new Low(adapter, { emails: [] });

async function initDB() {
  await db.read();
  await db.write();
}
initDB();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

app.post('/inbound-email', async (req, res) => {
  const emailData = req.body;
  const originalText = emailData.TextBody || '';
  const sender = emailData.From || 'unknown@sender.com';

  console.log('📬 Email Received from:', sender);
  console.log('📝 Original Message:', originalText);

  try {
    const translationRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://indox-translator.onrender.com',
        'X-Title': 'inbox-translator-app'
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: "You are a translation assistant. Translate the user's message to English if it's not already in English. If it's already in English, return it as is."
          },
          {
            role: 'user',
            content: originalText
          }
        ]
      })
    });

    const result = await translationRes.json();
    const translatedText = result.choices?.[0]?.message?.content || 'Translation failed.';

    await db.read();
    db.data.emails.push({
      id: nanoid(),
      from: sender,
      original: originalText,
      translated: translatedText,
      time: new Date().toLocaleString()
    });
    await db.write();

    await postmarkClient.sendEmail({
      From: process.env.FROM_EMAIL,
      To: sender,
      Subject: 'Translated Email (Inbox Translator)',
      TextBody: `Here is your translated message:\n\n${translatedText}`
    });

    console.log('✅ Translated message sent back to:', sender);
    res.status(200).send('Translation and email sent!');
  } catch (error) {
    console.error('❌ Failed:', error);
    res.status(500).send('Translation or email send error');
  }
});

app.get('/', async (req, res) => {
  await db.read();
  res.render('index', { emails: db.data.emails || [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
