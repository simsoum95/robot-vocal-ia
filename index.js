require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const twilio = require('twilio');

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.post('/voice', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  const speech = req.body.SpeechResult || '';

  // Si c’est le début de l’appel, on demande de parler
  if (!speech) {
    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      speechTimeout: 'auto',
      language: 'fr-FR'
    });
    gather.say({ voice: 'alice', language: 'fr-FR' }, "Bonjour, comment puis-je vous aider ?");
    return res.type('text/xml').send(twiml.toString());
  }

  // Répondre immédiatement pendant le traitement
  const wait = twiml.say({ voice: 'alice', language: 'fr-FR' }, "Un instant...");
  await new Promise(resolve => setTimeout(resolve, 500)); // petite pause factice

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [{ role: "user", content: speech }],
      max_tokens: 100,
      temperature: 0.7
    });

    const responseText = completion.choices[0].message.content;

    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      speechTimeout: 'auto',
      language: 'fr-FR'
    });
    gather.say({ voice: 'alice', language: 'fr-FR' }, responseText + " Souhaitez-vous autre chose ?");

  } catch (error) {
    console.error("Erreur OpenAI:", error.message);
    twiml.say({ voice: 'alice', language: 'fr-FR' }, "Désolé, une erreur est survenue.");
  }

  res.type('text/xml').send(twiml.toString());
});

app.listen(port, () => {
  console.log(`Serveur en ligne sur le port ${port}`);
});
