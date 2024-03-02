const axios = require('axios');

const _axios = axios.create({
  timeout: 30000,
  headers: { 'User-Agent': 'In Situ Labs App' }
});

class ODKError extends Error {
  constructor(error, context, ...params) {
    let message = typeof error === 'string' ? error : error.message;
    super(message, params);

    this.name = 'ODKError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ODKError);
    }
  }
}

class OdkClient {
  server = null;
  user = null;
  pass = null;
  ODK_TOKEN = null;
  ODK_TOKEN_TTL = null;

  constructor(server, user, pass) {
    this.server = server;
    this.user = user;
    this.pass = pass;
  }

  async #login() {
    if (this.ODK_TOKEN && Date.now() < this.ODK_TOKEN_TTL) {
      return Promise.resolve(this.ODK_TOKEN);
    }

    return _axios
      .post(`${this.server}/v1/sessions`, {
        email: this.user,
        password: this.pass
      })
      .then((resp) => {
        this.ODK_TOKEN = resp.data.token;
        // ODK token says it's good for 24 hours, but we'll cache for 23hrs to be safe.
        this.ODK_TOKEN_TTL = Date.now() + 1000 * 60 * 60 * 12;
        return resp.data.token;
      })
      .catch((error) => {
        throw new ODKError(error, this.onError(error));
      });
  }

  onError(error) {
    let context = {
      url: error.config.url,
      method: error.config.method
    };

    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      context.data = error.response.data;
      context.status = error.response.status;
      context.headers = error.response.headers;
    }

    return context;
  }

  #normalizeKey(key) {
    return key.replace('@odata.navigationLink', '');
  }

  async #normalizeValue(key, value) {
    if (value && typeof value === 'object') {
      let dto = {};
      for (const prop in value) {
        dto[this.#normalizeKey(prop)] = await this.#normalizeValue(prop, value[prop]);
      }
      return dto;
    } else {
      return value;
    }
  }

  #normalizeSubmission(submission) {
    const SKIP_KEYS = ['__id', 'logo', '__system', 'meta'];
    let dto = {};
    dto._externalId = submission.__id.replace(/^uuid:/, '');
    dto._created = new Date(submission.__system.submissionDate);
    dto._submitterName = submission.__system.submitterName;
    dto._submitterId = submission.__system.submitterId;
    dto._attachmentsPresent = submission.__system.attachmentsPresent;
    // TODO
    // __system.updatedAt
    // __system.status
    // __system.reviewState
    // __system.deviceId
    // __system.deviceId

    let keys = Object.keys(submission).filter((k) => !SKIP_KEYS.includes(k));

    return Promise.all(
      keys.map((k) => {
        return this.#normalizeValue(k, submission[k]).then((normalized) => {
          dto[this.#normalizeKey(k)] = normalized;
        });
      })
    ).then(() => {
      return dto;
    });
  }

  // /v1/projects/6/forms/environmental_sampling_records/fields?odata=false
  async getFormFields(projectId, formId) {
    await this.#login();
    return _axios
      .get(`${this.server}/v1/projects/${projectId}/forms/${formId}/fields?odata=false`, {
        headers: {
          Authorization: `Bearer ${this.ODK_TOKEN}`
        }
      })
      .then((resp) => {
        return resp.data;
      });
  }

  async getAttachmentMeta(projectId, formId, endpoint) {
    await this.#login();
    return _axios
      .get(`${this.server}/v1/projects/${projectId}/forms/${formId}.svc/${endpoint}`, {
        headers: {
          Authorization: `Bearer ${this.ODK_TOKEN}`
        }
      })
      .then((resp) => {
        return resp.data.value;
      })
      .catch((error) => {
        if (error.response && error.response.status === 404) {
          return null;
        }

        throw new ODKError(error, this.onError(error));
      });
  }

  async listSubmissionAttachments(projectId, formId, submissionId) {
    if (!projectId || !formId || !submissionId) {
      throw new Error('Invalid arguments for listing submission attachments.');
    }

    await this.#login();
    return _axios
      .get(
        `${this.server}/v1/projects/${projectId}/forms/${formId}/submissions/uuid:${submissionId}/attachments`,
        {
          headers: {
            Authorization: `Bearer ${this.ODK_TOKEN}`
          }
        }
      )
      .then((resp) => {
        if (resp.data && Array.isArray(resp.data)) {
          return resp.data
            .filter((f) => f.exists)
            .map((f) => {
              return {
                name: f.name
              };
            });
        }
        return [];
      })
      .catch((error) => {
        if (error.response && error.response.status === 404) {
          return [];
        }

        throw new ODKError(error, this.onError(error));
      });
  }

  // /v1/projects/6/forms/environmental_sampling_records/submissions/uuid:af517f8f-29df-4f41-901c-0061124d01b1/attachments/1610892426043.jpg
  async getAttachment(projectId, formId, submissionId, fileName) {
    try {
      let response = await _axios.get(
        `${this.server}/v1/projects/${projectId}/forms/${formId}/submissions/uuid:${submissionId}/attachments/${fileName}`,
        {
          headers: {
            Authorization: `Bearer ${this.ODK_TOKEN}`
          },
          responseType: 'arraybuffer'
        }
      );

      return {
        name: fileName,
        size: response.data.length,
        file: response.data
      };
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.error(
          `ODK attachment not found: ${projectId} ${formId} ${submissionId} ${fileName}`
        );
        return null;
      } else {
        throw new ODKError(error, this.onError(error));
      }
    }
  }

  // /v1/projects/3/forms/new_arrival_RC.svc/Submissions
  // Read about pagination options:
  // https://odkcentral.docs.apiary.io/#reference/odata-endpoints/odata-form-service/data-document
  async getSubmissions(projectId, formId) {
    await this.#login();
    return _axios
      .get(`${this.server}/v1/projects/${projectId}/forms/${formId}.svc/Submissions`, {
        headers: {
          Authorization: `Bearer ${this.ODK_TOKEN}`
        }
      })
      .then((resp) => {
        // console.log(require('util').inspect(resp.data, { showHidden: false, depth: null }));
        return Promise.all(resp.data.value.map(this.#normalizeSubmission.bind(this)));
      })
      .catch((error) => {
        if (error.response) {
          if (error.response.status === 404) {
            throw new Error(`ODK form not found: ${projectId} ${formId}`);
          }
        }
        throw new ODKError(error, this.onError(error));
      });
  }

  /**
   * Get the projects.
   * @param {Array} projectIds IDs of projects to filter for.
   * @param {Boolean} includeArchived
   * @returns {Array} The list of projects. A project will look like:
   *   {
   *   id: 6,
   *   name: 'Environmental Sampling',
   *   archived: null,
   *   keyId: null,
   *   createdAt: '2021-01-10T00:49:40.174Z',
   *   updatedAt: '2021-01-10T03:33:07.314Z',
   *   forms: 1,
   *   appUsers: 6,
   *   lastSubmission: '2021-03-08T06:30:03.181Z'
   *   }
   */
  async getProjects(projectIds, includeArchived = false) {
    await this.#login();
    const getProjectForms = (projectId) => {
      return _axios
        .get(`${this.server}/v1/projects/${projectId}/forms`, {
          headers: {
            Authorization: `Bearer ${this.ODK_TOKEN}`,
            'X-Extended-Metadata': true
          }
        })
        .then((resp) => resp.data);
    };

    return _axios
      .get(`${this.server}/v1/projects`, {
        headers: {
          Authorization: `Bearer ${this.ODK_TOKEN}`,
          'X-Extended-Metadata': true
        }
      })
      .then(async (resp) => {
        // console.log(require('util').inspect(resp.data, { showHidden: false, depth: null }));
        let projects = resp.data;
        if (!includeArchived) {
          projects = projects.filter((p) => p.archived !== true);
        }

        if (projectIds && Array.isArray(projectIds)) {
          projects = projects.filter((p) => {
            return projectIds.some((id) => id == p.id);
          });
        }

        for (let project of projects) {
          if (project.forms) {
            project.forms = await getProjectForms(project.id);
          } else {
            project.forms = [];
          }
        }

        return Promise.all(projects);
      })
      .catch((error) => {
        throw new ODKError(error, this.onError(error));
      });
  }
}

module.exports = OdkClient;

