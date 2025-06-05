require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post('/voice', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const speech = req.body.SpeechResult;

  if (!speech) {
    // Première interaction
    const gather = twiml.gather({
      input: 'speech',
      language: 'fr-FR',
      timeout: 3,
      action: '/voice',
      method: 'POST'
    });
    gather.say({ voice: 'alice', language: 'fr-FR' }, "Bonjour, comment puis-je vous aider ?");
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Phrase rapide avant de réfléchir
  twiml.say({ voice: 'alice', language: 'fr-FR' }, "Un instant, je réfléchis à votre demande...");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [{ role: "user", content: speech }],
    });

    const responseText = completion.choices[0].message.content;

    const gather = twiml.gather({
      input: 'speech',
      language: 'fr-FR',
      timeout: 3,
      action: '/voice',
      method: 'POST'
    });

    gather.say({ voice: 'alice', language: 'fr-FR' }, responseText + " Souhaitez-vous autre chose ?");
  } catch (error) {
    console.error("Erreur OpenAI:", error.message);
    twiml.say({ voice: 'alice', language: 'fr-FR' }, "Désolé, une erreur est survenue. Veuillez réessayer plus tard.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

app.get('/', (req, res) => res.send('Robot vocal IA en ligne'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en ligne sur le port ${PORT}`));
