const express = require('express');
const bodyParser = require('body-parser');
const { VoiceResponse } = require('twilio').twiml;

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

let hasSaidNo = false;

app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();

  if (hasSaidNo) {
    twiml.say({ voice: 'Polly.Celine', language: 'fr-FR' }, "Très bien, je vous souhaite une excellente journée. Au revoir.");
    twiml.hangup();
    hasSaidNo = false;
  } else {
    const gather = twiml.gather({
      input: 'speech',
      action: '/handle-speech',
      method: 'POST',
      speechTimeout: 'auto'
    });

    gather.say({ voice: 'Polly.Celine', language: 'fr-FR' },
      "Bonjour, je suis l'assistante de Monsieur Haliwa, expert en intelligence artificielle. Comment puis-je vous aider aujourd'hui ?");

    res.type('text/xml');
    res.send(twiml.toString());
  }
});

app.post('/handle-speech', (req, res) => {
  const speech = (req.body.SpeechResult || '').toLowerCase();
  const twiml = new VoiceResponse();

  if (speech.includes('non')) {
    hasSaidNo = true;
    res.redirect('/voice');
  } else {
    const gather = twiml.gather({
      input: 'speech',
      action: '/handle-speech',
      method: 'POST',
      speechTimeout: 'auto'
    });

    gather.say({ voice: 'Polly.Celine', language: 'fr-FR' },
      "Très bien, un instant s'il vous plaît pendant que je traite votre demande...");

    res.type('text/xml');
    res.send(twiml.toString());
  }
});

app.listen(port, () => {
  console.log(`Serveur actif sur le port ${port}`);
});
