Vue.createApp({
  delimiters: ['${', '}'],
  data() {
    return {
      loading: false,
      mapping: {},
      fields: [],
      headers: null,
      samples: [],
      isBulkEdit: false,
      sampleIndex: 0,
      submissionSamples: [],
      submissionSampleIndex: 0,
      error: typeof window._error === 'string' ? window._error : null,
      language: window._language || null
    };
  },

  computed: {
    validFieldMapping() {
      let mappedFields = Object.values(this.mapping).filter(Boolean);
      return mappedFields.length > 0 && Object.keys(this.invalidFields).length === 0;
    },

    invalidFields() {
      let invalid = {};
      Object.keys(this.mapping).forEach((id) => {
        if (this.mapping[id]) {
          if (!this.fields.find((df) => df.id === this.mapping[id])) {
            invalid[id] = true;
          } else {
            // A field can only be used once.
            let occurrences = Object.values(this.mapping).filter(
              (v) => v === this.mapping[id]
            ).length;
            if (occurrences > 1) {
              invalid[id] = true;
            }
          }
        }
      });

      return invalid;
    },

    remainingFields() {
      return this.fields.filter((f) => {
        return !Object.values(this.mapping).includes(f.id);
      });
    },

    mappedFieldIds() {
      return this.fields
        .filter((f) => {
          return Object.values(this.mapping).includes(f.id);
        })
        .map((f) => f.id);
    },

    sample() {
      if (this.samples.length > 0 && this.sampleIndex < this.samples.length) {
        return this.samples[this.sampleIndex];
      }
      return {};
    },

    submissionSample() {
      if (
        this.submissionSamples.length > 0 &&
        this.submissionSampleIndex < this.submissionSamples.length
      ) {
        let sample = this.submissionSamples[this.submissionSampleIndex].data;
        sample.created = this.submissionSamples[this.submissionSampleIndex].created;
        return sample;
      }
      return {};
    },

    /**
     * Generate the field to heading JSON string for the backend.
     * @return {String}
     */
    mappingAsJSON() {
      if (this.validFieldMapping) {
        let mapping = {};
        for (let heading of Object.keys(this.mapping)) {
          let fieldId = this.mapping[heading];
          if (fieldId) {
            mapping[heading] = fieldId;
          }
        }

        if (this.isBulkEdit) {
          mapping[this.idHeading] = this.idHeading;
        }

        return JSON.stringify(mapping);
      }
      return '';
    },

    isFormDisabled() {
      if (this.loading || (this.headers && !this.validFieldMapping)) {
        return true;
      }
      return false;
    },

    /**
     * The list of column names to render from the upload.
     * Will not return an ID field for bulk edit.
     * @return {Array} The headers parsed headers of the upload.
     */
    visibleHeaders() {
      if (this.headers && this.isBulkEdit && this.idHeading) {
        return this.headers.filter((h) => h !== this.idHeading);
      }
      return this.headers;
    },

    /**
     * Get a possible matching ID column for bulk edit to key off of.
     * @return {String} The ID heading name.
     */
    idHeading() {
      let options = ['ID', 'id', '_id'];
      if (this.headers) {
        for (let option of options) {
          if (this.headers.includes(option)) {
            return option;
          }
        }
      }
      return null;
    }
  },

  watch: {
    /**
     * When we toggle bulk edit mode, clear any mapping to a possible ID field.
     */
    isBulkEdit() {
      if (this.idHeading) {
        delete this.mapping[this.idHeading];
      }
    }
  },

  methods: {
    fieldHtmlId(header) {
      return header.replace(/\s/g, '_');
    },

    /**
     * Get the name for a field in the correct language.
     * @param {String || Object} id This can be the raw field or the id of a field.
     * @return {String}
     */
    fieldName(id) {
      let name = '';
      let field = id;
      if (typeof field === 'string') {
        field = this.fields.find((f) => f.id === id);
      }

      if (field) {
        if (this.language && field.altLang && field.altLang[this.language]) {
          name = field.altLang[this.language];
        }

        if (!name && field.name) {
          name = field.name;
        }

        if (!name) {
          name = field.id;
        }
      }

      return name;
    },

    /**
     * Increase the index of which sample record we're looking at.
     */
    nextSample() {
      let nextIndex = this.sampleIndex + 1;
      if (nextIndex >= this.samples.length) {
        nextIndex = 0;
      }
      this.sampleIndex = nextIndex;
    },

    /**
     * Increase the index of which destination sample record we're looking at.
     */
    nextSubmissionSample() {
      let nextIndex = this.submissionSampleIndex + 1;
      if (nextIndex >= this.submissionSamples.length) {
        nextIndex = 0;
      }
      this.submissionSampleIndex = nextIndex;
    },

    onSubmit(event) {
      event.preventDefault();
      this.error = null;
      this.loading = true;

      let formData = new FormData(this.$refs.form);
      formData.set('xhr', true);
      $api(this.$refs.form.getAttribute('action'), {
        method: this.$refs.form.getAttribute('method'),
        body: formData
      })
        .then((data) => {
          if (data.redirect) {
            window.location.href = data.redirect;
            return;
          }

          this.fields = data.fields;
          this.headers = data.headers;
          this.samples = data.samples;
          this.submissionSamples = data.submissionSamples;
          this.mapping = this.headers.reduce((mapping, h) => {
            let f = this.fields.find((f) => {
              if (f.id === h) {
                // ID match
                return true;
              } else if (f.name && f.name === h) {
                // English name match
                return true;
              } else if (this.language && field.altLang && field.altLang[this.language] === h) {
                // Alt lang name match
                return true;
              }
              return false;
            });

            if (f) {
              mapping[h] = f.id;
            }
            return mapping;
          }, {});

          if (this.idHeading) {
            this.isBulkEdit = null;
          }
        })
        .catch((error) => {
          this.error = error?.message ? error.message : error;
        })
        .finally(() => {
          this.loading = false;
        });
    }
  }
}).mount('#app');

