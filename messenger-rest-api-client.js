const axios = require('axios');

class Client {
  constructor(apiUrl) {
    const trimmedUrl = apiUrl.replace(/^\/+|\/+$/g, ''); // trim('/')
    console.log('apiUrl', trimmedUrl);
    axios.defaults.baseURL = `${trimmedUrl}/`;
  }

  async loginAs(username, password) {
    console.log('loginAs', username, password);

    const response = await Client.post('login', {
      username,
      password,
    });

    if ((response.status || 'error') !== 'success') {
      this.auth = null;
      console.error('loginAs failed:', username, password, response);
      throw response;
    } else {
      console.log('Logged in.', response.data);
    }

    this.auth = response.data;
    return true;
  }

  async authenticateWith(authToken, userId, callback) {
    const auth = this.auth;

    this.auth = {
      authToken,
      userId,
    };

    const ret = await callback();

    this.auth = auth;

    return ret;
  }

  authenticationAPI() {
    return {
      login: async (user, password) => Client.post('login', {
        user, password,
      }),
      me: async () => this.getWithAuth('me'),
    };
  }

  usersAPI() {
    return {
      info: async (identifier, value) => (this.getWithAuth('users.info', {
        params: {
          [identifier]: value,
        },
      })),
      register: (username, pass, name, email, optionalSecretURL = null) => Client.post('users.register', {
        username, pass, name, email, ...(optionalSecretURL ? { secretURL: optionalSecretURL } : {}),
      }),
      update: async (userId, data = {}) => this.postWithAuth('users.update', {
        userId, data,
      }),
    };
  }

  channelsAPI() {
    return {
      kick: async (roomId, userId) => this.postWithAuth('channels.kick', {
        roomId, userId,
      }),
    };
  }

  /**
   * Helper methods
   */
  static async get(endpoint, config = {}) {
    return (await axios.get(endpoint, config)).data;
  }

  static async post(endpoint, data = {}, config = {}) {
    if (endpoint === 'users.update') {
      console.log('users.update', data);
    }
    return (await axios.post(endpoint, data, config)).data;
  }

  async getWithAuth(endpoint, config = {}) {
    if (!this.auth) {
      console.log('Not authenticated, fallback to guest GET request');
      return Client.get(endpoint, config);
    }
    console.log('Authenticated GET request', endpoint, config, this.auth);
    return Client.get(endpoint, {
      ...config,
      headers: {
        'X-Auth-Token': this.auth.authToken,
        'X-User-Id': this.auth.userId,
      },
    });
  }

  async postWithAuth(endpoint, data = {}, config = {}) {
    if (!this.auth) {
      return Client.post(endpoint, data, config);
    }
    return Client.post(endpoint, data, {
      ...config,
      headers: {
        'X-Auth-Token': this.auth.authToken,
        'X-User-Id': this.auth.userId,
      },
    });
  }
}

module.exports = Client;
