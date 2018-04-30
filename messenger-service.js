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
    this.accounts = database.collection('accounts');
    this.client = client;
    this.userId = userId;
    this.messengerClient = new MessengerClient(process.env.MESSENGER_API_URL);

    this.loginAsAdmin();
  }

  /**
   * Get user authentication data.
   */
  getAuthenticationDetails() {
    if (this.hasCachedDetails()) {
      if (this.cachedDetailsStillValid()) {
        this.configureDefaultGroups();
        return this.messenger;
      }
      if (!this.messengerExists) {
        this.createRocketChatUser();
      }
    } else {
      this.createAndCacheRocketChatUser();
    }
    this.configureDefaultGroups();
    return this.loginToRocketChat();
  }

  /**
   * Authorize API requests with admin account.
   */
  loginAsAdmin() {
    this.messengerClient.loginAs(
      process.env.ROCKET_CHAT_ADMIN_USERNAME,
      process.env.ROCKET_CHAT_ADMIN_PASSWORD,
    );
  }

  /**
   * Authorize API requests using with user account.
   */
  authenticateAsUser(callback) {
    return this.messengerClient.authenticateWith(
      this.messenger.authToken,
      this.messenger.userId,
      callback,
    );
  }

  hasCachedDetails() {
    const account = this.accounts.findOne({ uid: this.userId });

    if (account) {
      this.messenger = account;
    }

    return !!account;
  }

  cachedDetailsStillValid() {
    if (!this.messenger.authToken) {
      return false;
    }
    return this.authenticateAsUser(() => {
      try {
        this.messengerClient.authenticationAPI().me();
        return true;
      } catch (e) {
        return false;
      }
    });
  }

  rocketChatUserExists(uid = null) {
    try {
      this.messengerClient.usersAPI().info('username', this.makeUsername(uid || this.userId));
      return true;
    } catch (e) {
      return false;
    }
  }

  createRocketChatUser(user = null) {
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
      response = this.messengerClient.usersAPI().register(
        this.makeUsername(uid),
        key,
        name,
        email,
      );
    } catch (e) {
      if (!user) {
        messengerUserId = this.changeRocketChatUserPassword(key).userId;
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

  createAndCacheRocketChatUser() {
    try {
      this.messenger = {
        ...this.messenger,
        ...this.createRocketChatUser(),
      };
    } catch (e) {
      this.messenger = {
        ...this.messenger,
        ...this.changeRocketChatUserPassword(),
      };
    }

    this.accounts.update({
      erUserId: this.erUserId,
    }, {
      messengerUserId: this.messenger.userId,
      authToken: this.messenger.authToken,
    });
  }

  changeRocketChatUserPassword(key = MessengerService.generateRocketChatKey()) {
    this.loginAsAdmin();

    const { user } = this.messengerClient.usersAPI().info('username', this.makeUsername(this.userId));
    const messengerUserId = user._id;

    this.messengerClient.usersAPI().update(messengerUserId, {
      password: key,
    });

    return {
      userId: messengerUserId,
      key,
    };
  }

  loginToRocketChat() {
    let authData;

    try {
      authData = this.messengerClient.authenticationAPI().login(
        this.makeUsername(this.userId),
        this.messenger.key,
      );
    } catch (e) {
      this.messenger = {
        ...this.messenger,
        ...this.changeRocketChatUserPassword(),
      };

      authData = this.messengerClient.authenticationAPI().login(
        this.makeUsername(this.userId),
        this.messenger.key,
      );
    }

    this.accounts.update({
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
      if (!this.rocketChatUserExists(user.uid)) {
        const { userId } = this.createRocketChatUser(user);
        this.configureDefaultGroups(userId);
      }
      user.username = this.makeUsername(user.uid);
    }

    return users;
  }

  configureDefaultGroups(messengerUserId = this.messenger.userId) {
    // Kick from general channel
    try {
      this.messengerClient.channelsAPI().kick('GENERAL', messengerUserId);
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

export default MessengerService;
