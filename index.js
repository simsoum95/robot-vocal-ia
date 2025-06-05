require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { twiml: { VoiceResponse } } = require('twilio');
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post('/voice', async (req, res) => {
  const userSpeech = req.body.SpeechResult || "";

  const twiml = new VoiceResponse();

  // Si c’est le premier appel sans texte, on commence l’accueil
  if (!userSpeech) {
    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      method: 'POST'
    });

    gather.say(
      { voice: 'Polly.Celine', language: 'fr-FR' },
      "Bonjour, je suis l’assistante de Monsieur Aliwa, expert en intelligence artificielle. Comment puis-je vous aider aujourd’hui ?"
    );

    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Si l'utilisateur dit "non", on raccroche gentiment
  if (userSpeech.toLowerCase().includes("non")) {
    twiml.say({ voice: 'Polly.Celine', language: 'fr-FR' }, "Très bien. Je vous souhaite une excellente journée. Au revoir !");
    twiml.hangup();
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Sinon on continue la conversation avec l’IA
  const waiting = twiml.say({ voice: 'Polly.Celine', language: 'fr-FR' });
  waiting.pause({ length: 1 });
  waiting.say("Un instant, je réfléchis...");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Tu es une assistante vocale douce, polie et professionnelle. Tu aides les gens pour prendre rendez-vous, donner des infos sur les projets de Monsieur Aliwa ou ses services." },
        { role: "user", content: userSpeech }
      ]
    });

    const answer = completion.choices[0].message.content;

    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      method: 'POST'
    });

    gather.say({ voice: 'Polly.Celine', language: 'fr-FR' }, answer);

    res.type('text/xml');
    res.send(twiml.toString());

  } catch (error) {
    console.error("Erreur GPT:", error.message);
    twiml.say({ voice: 'Polly.Celine', language: 'fr-FR' }, "Désolé, une erreur est survenue. Veuillez réessayer plus tard.");
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

app.get('/', (req, res) => res.send('Robot vocal IA en ligne'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Serveur en ligne sur le port", PORT));
