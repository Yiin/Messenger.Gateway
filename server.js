// configure env variables
require('dotenv').config();

// app
const app = require('express')();

// database
const client = require('mongodb').MongoClient;

client.connect(process.env.DATABASE, (err) => {
  if (err) {
    console.error(err);
    process.exit();
  } else {
    console.log('Connected to database.');
  }
});

// routes
app.get('/', (req, res) => {
  res.json({ hello: 'world' });
});

// run
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Messenger Gateway is running on port ${port}`);
});
