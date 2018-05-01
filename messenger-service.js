const axios = require('axios');
const MessengerClient = require('rocketchat');

async function getUsers() {
  const { data } = await axios.get('/users', {
    headers: {
      'X-Temporary-API-Token': process.env.ER_API_TEMP_TOKEN,
    },
  });

  return data;
}

class MessengerService {
  constructor(database, { client, userId }) {
    console.log('new MessengerService', client, userId);
    this.accounts = database.collection('accounts');
    this.client = client;
    this.userId = userId;
    this.messengerClient = new MessengerClient(process.env.MESSENGER_API_URL);

    this.loginAsAdmin();
  }

  /**
   * Get user authentication data.
   */
  async getAuthenticationDetails() {
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
      this.messenger.userId,
      callback,
    );
  }

  async hasCachedDetails() {
    const account = await this.accounts.findOne({ uid: this.userId });

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
      await this.messengerClient.usersAPI().info('username', this.makeUsername(uid || this.userId));
      return true;
    } catch (e) {
      return false;
    }
  }

  async createRocketChatUser(user = null) {
    const key = MessengerService.generateRocketChatKey();

    let uid;
    let name;

    if (user) {
      uid = user.uid;
      name = user.name;
    } else {
      uid = this.userId;
      name = this.name;
    }

    const email = `${this.client}-${uid}@erapp.dk`;

    let response;
    let messengerUserId;

    try {
      response = await this.messengerClient.usersAPI().register(
        this.makeUsername(uid),
        key,
        name,
        email,
      );
    } catch (e) {
      if (!user) {
        messengerUserId = await this.changeRocketChatUserPassword(key).userId;
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
      erUserId: this.erUserId,
    }, {
      messengerUserId: this.messenger.userId,
      authToken: this.messenger.authToken,
    });
  }

  async changeRocketChatUserPassword(key = MessengerService.generateRocketChatKey()) {
    this.loginAsAdmin();

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
    const users = await getUsers()
      // exclude ourselves
      .filter(user => user.uid !== this.userId);

    for (const user of users) {
      if (!await this.rocketChatUserExists(user.uid)) {
        const { userId } = await this.createRocketChatUser(user);
        await this.configureDefaultGroups(userId);
      }
      user.username = this.makeUsername(user.uid);
    }

    return users;
  }

  async configureDefaultGroups(messengerUserId = this.messenger.userId) {
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
