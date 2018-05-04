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
    this.userId = userId;
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
        console.log('use cachedDetails');
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
    if (this.users) {
      return;
    }
    this.users = await getUsers(this.client);
    const me = this.users.find(user => +user.id === +this.userId);

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
    console.log('hasCachedDetails');
    const account = await this.accounts.findOne({ erUserId: this.userId });

    if (account) {
      this.messenger = account;
    }

    return !!account;
  }

  async cachedDetailsStillValid() {
    console.log('cachedDetailsStillValid');
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
    console.log('rocketChatUserExists', uid);
    try {
      await this.messengerClient.usersAPI().info('username', this.makeUsername(uid || this.userId));
      return true;
    } catch (e) {
      return false;
    }
  }

  async createRocketChatUser(erUser = null) {
    console.log('createRocketChatUser', erUser);
    const key = MessengerService.generateRocketChatKey();

    let erUserId;
    let name;

    if (erUser) {
      erUserId = erUser.id;
      name = erUser.full_name;
    } else {
      erUserId = this.userId;
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
        messengerUserId = (await this.changeRocketChatUserPassword(key)).userId;
      }
    }

    if (!messengerUserId) {
      messengerUserId = response.user._id;
    }

    return {
      userId: messengerUserId,
      key,
    };
  }

  async createAndCacheRocketChatUser() {
    console.log('createAndCacheRocketChatUser');
    try {
      this.messenger = {
        ...this.messenger,
        ...await this.createRocketChatUser(),
      };
    } catch (e) {
      console.log('createRocketChatUser threw an exception O.o', e);
      this.messenger = {
        ...this.messenger,
        ...await this.changeRocketChatUserPassword(),
      };
    }

    await this.accounts.update({
      erUserId: this.erUserId,
    }, {
      messengerUserId: this.messenger.messengerUserId,
      authToken: this.messenger.authToken,
    });
  }

  async changeRocketChatUserPassword(key = MessengerService.generateRocketChatKey()) {
    console.log('changeRocketChatUserPassword');
    const { user } = await this.messengerClient.usersAPI().info('username', this.makeUsername(this.userId));

    const messengerUserId = user._id;

    await this.messengerClient.usersAPI().update(messengerUserId, {
      password: key,
    });

    return {
      userId: messengerUserId,
      key,
    };
  }

  async loginToRocketChat() {
    console.log('loginToRocketChat');
    let authData;

    try {
      authData = await this.messengerClient.authenticationAPI().login(
        this.makeUsername(this.userId),
        this.messenger.key,
      );
    } catch (e) {
      this.messenger = {
        ...this.messenger,
        ...await this.changeRocketChatUserPassword(),
      };

      authData = await this.messengerClient.authenticationAPI().login(
        this.makeUsername(this.userId),
        this.messenger.key,
      );
    }

    await this.accounts.update({
      erUserId: this.userId,
    }, {
      authToken: this.messenger.authToken,
      key: this.messenger.key,
    });

    return authData;
  }

  async getContacts() {
    const users = this.users
      // exclude ourselves
      .filter(user => user.id !== this.userId);

    for (const user of users) {
      if (!await this.rocketChatUserExists(user.id)) {
        const { userId } = await this.createRocketChatUser(user);
        await this.configureDefaultGroups(userId);
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
