import axios from 'axios';

class Client {
  constructor(apiUrl) {
    const trimmedUrl = apiUrl.replace(/^\/+|\/+$/g, ''); // trim('/')
    axios.defaults.baseURL = `${trimmedUrl}/`;
  }

  async loginAs(username, password) {
    const response = await Client.post('login', {
      username,
      password,
    });

    if ((response.status || 'error') !== 'success') {
      this.auth = null;
      throw this.createExceptionFromResponse(response, 'loginAs');
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
      info: async (identifier, value) => this.getWithAuth('users.info', {
        params: {
          [identifier]: value,
        },
      }),
      register: (username, password, name, email, optionalSecretURL = null) => Client.post('users.register', {
        username, password, name, email, ...(optionalSecretURL ? { optionalSecretURL } : {}),
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
    return axios.get(endpoint, config).data;
  }

  static async post(endpoint, data = {}, config = {}) {
    return axios.post(endpoint, data, config);
  }

  async getWithAuth(endpoint, config = {}) {
    if (!this.auth) {
      return Client.get(endpoint, config);
    }
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
