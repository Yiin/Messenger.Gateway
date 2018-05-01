// database
const client = require('mongodb').MongoClient;

module.exports = {
  connect: async function connect() {
    console.log('Connecting to database...');
    try {
      const database = await client.connect(process.env.DATABASE);

      console.log('Connected to database.');

      return database;
    } catch (e) {
      console.log('Retrying in one second...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return connect();
    }
  },
};
