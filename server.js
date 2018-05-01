(async () => {
  // configure env variables
  require('dotenv').config();

  // app
  const app = require('express')();
  app.use(require('body-parser').json());

  // messenger service
  const MessengerService = require('./messenger-service');

  // database
  const database = await require('./database').connect();

  // routes
  app.post('/authenticate', async (req, res) => {
    const messengerService = new MessengerService(database, req.body);
    const authenticationDetails = await messengerService.getAuthenticationDetails();
    const contacts = await messengerService.getContacts();

    res.json({
      ...authenticationDetails,
      users: contacts,
    });
  });

  // run
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Messenger Gateway is running on port ${port}`);
  });
})();
