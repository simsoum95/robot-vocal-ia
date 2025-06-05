require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.post('/voice', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const speech = req.body.SpeechResult || "Je n'ai pas compris.";

  // Répond tout de suite avec un "un instant"
  twiml.say({ voice: 'alice', language: 'fr-FR' }, "Un instant, je réfléchis...");

  try {
    // Ajouter une pause pour simuler un temps de réflexion
    twiml.pause({ length: 1 });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [
        { role: "system", content: "Tu es un assistant vocal très réactif et utile." },
        { role: "user", content: speech }
      ],
      max_tokens: 100,
      temperature: 0.7
    });

    const responseText = completion.choices[0].message.content;
    twiml.say({ voice: 'alice', language: 'fr-FR' }, responseText);

    // Optionnel : ajouter une question pour continuer ou non
    twiml.gather({ input: 'speech', timeout: 5, action: '/voice', method: 'POST' })
         .say({ voice: 'alice', language: 'fr-FR' }, "Souhaitez-vous autre chose ?");

  } catch (error) {
    console.error("Erreur OpenAI:", error.message);
    twiml.say({ voice: 'alice', language: 'fr-FR' }, "Désolé, une erreur est survenue.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur en ligne sur le port " + PORT);
});

