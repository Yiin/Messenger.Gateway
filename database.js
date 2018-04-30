// database
const client = require('mongodb').MongoClient;

export default {
  connect: async () => {
    let database;

    try {
      database = await client.connect(process.env.DATABASE);
    } catch (e) {
      console.error(e.getMessage());
      process.exit();
    }

    console.log('Connected to database.');

    return database;
  },
};
