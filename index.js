// index.js sans ElevenLabs, voix naturelle Twilio (manon)
const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const twilio = require("twilio");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.urlencoded({ extended: false }));

let lastUserInput = "";

app.post("/voice", async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: "speech",
    speechTimeout: "auto",
    action: "/process",
    method: "POST",
    language: "fr-FR",
    voice: "manon"
  });

  gather.say(
    {
      voice: "manon",
      language: "fr-FR"
    },
    "Bonjour, je suis l'assistante de Monsieur Aliwa, expert en intelligence artificielle. Comment puis-je vous aider aujourd’hui ?"
  );

  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/process", async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const userSpeech = req.body.SpeechResult;

  if (!userSpeech) {
    twiml.say({ voice: "manon", language: "fr-FR" }, "Désolé, je n'ai pas compris. Pouvez-vous répéter ?");
    twiml.redirect("/voice");
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // Si la personne dit "non" -> on raccroche
  if (userSpeech.trim().toLowerCase().includes("non")) {
    twiml.say({ voice: "manon", language: "fr-FR" }, "Très bien. Passez une excellente journée ! Au revoir.");
    twiml.hangup();
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [
        { role: "system", content: "Tu es une assistante téléphonique très polie, professionnelle et efficace. Tu t’exprimes avec douceur, en français, et tu aides les clients comme une vraie secrétaire personnelle. Si la personne semble vouloir raccrocher, propose de l’aide une dernière fois, puis dis au revoir." },
        { role: "user", content: userSpeech }
      ]
    });

    const aiReply = chatCompletion.choices[0].message.content;
    lastUserInput = userSpeech;

    const gather = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR",
      voice: "manon"
    });

    gather.say({ voice: "manon", language: "fr-FR" }, aiReply);
    res.type("text/xml");
    res.send(twiml.toString());
  } catch (error) {
    console.error("Erreur GPT:", error);
    twiml.say({ voice: "manon", language: "fr-FR" }, "Une erreur est survenue. Veuillez réessayer plus tard.");
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.listen(port, () => {
  console.log(`Serveur actif sur le port ${port}`);
});
