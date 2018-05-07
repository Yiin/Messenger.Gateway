const axios = require('axios');
const MessengerClient = require('./messenger-rest-api-client');

async function getUsers(client) {
  const response = await axios.get(`${process.env.ERAPP_API_URL}/${client}/users`, {
    headers: {
      'X-Temporary-API-Token': process.env.ER_API_TEMP_TOKEN,
    },
  });

  return response.data;
}

class MessengerService {
  constructor(database, { client, userId }) {
    this.accounts = database.collection('accounts');
    this.client = client;
    this.erUserId = userId;
    this.messengerClient = new MessengerClient(process.env.MESSENGER_API_URL);
  }

  /**
   * Get user authentication data.
   */
  async getAuthenticationDetails() {
    await this.fetchUsers();

    if (await this.hasCachedDetails()) {
      if (await this.cachedDetailsStillValid()) {
        await this.configureDefaultGroups();
        return this.messenger;
      }
      if (!this.messengerExists) {
        await this.createRocketChatUser();
      }
    } else {
      await this.createAndCacheRocketChatUser();
    }
    await this.configureDefaultGroups();
    return this.loginToRocketChat();
  }

  async fetchUsers() {
    if (this.erUsers) {
      return;
    }
    this.erUsers = await getUsers(this.client);
    const me = this.erUsers.find(erUser => +erUser.id === +this.erUserId);

    if (!me) {
      throw new Error('We don\'t exist.');
    }

    this.me = me;
  }

  /**
   * Authorize API requests with admin account.
   */
  async loginAsAdmin() {
    return this.messengerClient.loginAs(
      process.env.ROCKET_CHAT_ADMIN_USERNAME,
      process.env.ROCKET_CHAT_ADMIN_PASSWORD,
    );
  }

  /**
   * Authorize API requests using with user account.
   */
  async authenticateAsUser(callback) {
    return this.messengerClient.authenticateWith(
      this.messenger.authToken,
      this.messenger.messengerUserId,
      callback,
    );
  }

  async hasCachedDetails() {
    const account = await this.accounts.findOne({ _id: this.erUserId });

    if (account) {
      this.messenger = account;
    }

    return !!account;
  }

  async cachedDetailsStillValid() {
    if (!this.messenger.authToken) {
      return false;
    }
    return this.authenticateAsUser(async () => {
      try {
        await this.messengerClient.authenticationAPI().me();
        return true;
      } catch (e) {
        return false;
      }
    });
  }

  async rocketChatUserExists(uid = null) {
    try {
      await this.messengerClient.usersAPI().info('username', this.makeUsername(uid || this.erUserId));
      return true;
    } catch (e) {
      return false;
    }
  }

  async createRocketChatUser(erUser = null) {
    const key = MessengerService.generateRocketChatKey();

    let erUserId;
    let name;

    if (erUser) {
      erUserId = erUser.id;
      name = erUser.full_name;
    } else {
      erUserId = this.erUserId;
      name = this.me.full_name;
    }

    const email = `${this.client}-${erUserId}@erapp.dk`;

    let response;
    let messengerUserId;

    try {
      response = await this.messengerClient.usersAPI().register(
        this.makeUsername(erUserId),
        key,
        name,
        email,
      );
    } catch (e) {
      // Change password only if we were trying to create user for ourselves.
      if (!erUser) {
        messengerUserId = (await this.changeRocketChatUserPassword(key)).messengerUserId;
      }
    }

    if (!messengerUserId) {
      messengerUserId = response.user._id;
    }

    return {
      messengerUserId,
      key,
    };
  }

  async createAndCacheRocketChatUser() {
    try {
      this.messenger = {
        ...this.messenger,
        ...await this.createRocketChatUser(),
      };
    } catch (e) {
      this.messenger = {
        ...this.messenger,
        ...await this.changeRocketChatUserPassword(),
      };
    }

    await this.accounts.update({
      _id: this.erUserId,
    }, {
      $set: this.messenger,
    }, {
      upsert: true,
    });
  }

  async changeRocketChatUserPassword(key = MessengerService.generateRocketChatKey()) {
    const { user } = await this.messengerClient.usersAPI().info('username', this.makeUsername(this.erUserId));

    const messengerUserId = user._id;

    await this.messengerClient.usersAPI().update(messengerUserId, {
      password: key,
    });

    return {
      messengerUserId,
      key,
    };
  }

  async loginToRocketChat() {
    let authData;

    try {
      authData = (await this.messengerClient.authenticationAPI().login(
        this.makeUsername(this.erUserId),
        this.messenger.key,
      )).data;
    } catch (e) {
      this.messenger = {
        ...this.messenger,
        ...await this.changeRocketChatUserPassword(),
      };

      authData = (await this.messengerClient.authenticationAPI().login(
        this.makeUsername(this.erUserId),
        this.messenger.key,
      )).data;
    }

    await this.accounts.update({
      _id: this.erUserId,
    }, {
      $set: {
        authToken: authData ? authData.authToken : this.messenger.authToken,
        key: this.messenger.key,
      },
    }, {
      upsert: true,
    });

    return authData;
  }

  async getContacts() {
    const users = this.erUsers
      // exclude ourselves
      .filter(user => user.id !== this.erUserId);

    for (const user of users) {
      if (!await this.rocketChatUserExists(user.id)) {
        const { messengerUserId } = await this.createRocketChatUser(user);
        await this.configureDefaultGroups(messengerUserId);
      }
      user.username = this.makeUsername(user.id);
    }

    return users;
  }

  async configureDefaultGroups(messengerUserId = this.messenger.messengerUserId) {
    // Kick from general channel
    try {
      await this.messengerClient.channelsAPI().kick('GENERAL', messengerUserId);
    } catch (e) {
      // user is not in the channel
    }
  }

  makeUsername(uid) {
    return `${this.client}_${uid}`;
  }

  static generateRocketChatKey() {
    return Math.random().toString(36).slice(-32);
  }
}

module.exports = MessengerService;
