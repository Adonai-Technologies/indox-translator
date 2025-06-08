const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();
const { ServerClient } = require('postmark');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const postmarkClient = new ServerClient(process.env.POSTMARK_API_KEY);
const receivedEmails = [];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// POST: Receive and translate email
app.post('/inbound-email', async (req, res) => {
  const emailData = req.body;
  const originalText = emailData.TextBody || "";
  const sender = emailData.From || "unknown@sender.com";

  console.log('📬 Email Received from:', sender);
  console.log('📝 Original Message:', originalText);

  try {
    // Translate the message using OpenRouter (always attempt)
    const translationRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://indox-translator.onrender.com",
        "X-Title": "inbox-translator-app"
      },
      body: JSON.stringify({
        model: "openai/gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a translation assistant. Translate the user's message to English if it's not already in English. If it's already in English, return it as is."
          },
          {
            role: "user",
            content: originalText
          }
        ]
      })
    });

    const result = await translationRes.json();
    const translatedText = result.choices?.[0]?.message?.content || "Translation failed.";

    // Store in in-memory list
    receivedEmails.push({
      from: sender,
      original: originalText,
      translated: translatedText,
      time: new Date().toLocaleString()
    });

    // Send translated email back
    await postmarkClient.sendEmail({
      From: process.env.FROM_EMAIL,
      To: sender,
      Subject: "Translated Email (Inbox Translator)",
      TextBody: `Here is your translated message:\n\n${translatedText}`
    });

    console.log('✅ Translated message sent back to:', sender);
    res.status(200).send('Translation and email sent!');
  } catch (error) {
    console.error('❌ Failed:', error);
    res.status(500).send('Translation or email send error');
  }
});

// GET: Homepage with translated emails
app.get('/', (req, res) => {
  res.render('index', { emails: receivedEmails });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
