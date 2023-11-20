Vue.createApp({
  delimiters: ['${', '}'],
  data() {
    return {
      loading: false,
      mapping: {},
      fields: [],
      headers: null,
      samples: [],
      sampleIndex: 0,
      submissionSamples: [],
      submissionSampleIndex: 0,
      error: typeof window._error === 'string' ? window._error : null
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

        return JSON.stringify(mapping);
      }
      return '';
    },

    isFormDisabled() {
      if (this.loading || (this.headers && !this.validFieldMapping)) {
        return true;
      }
      return false;
    }
  },

  methods: {
    fieldHtmlId(header) {
      return header.replace(/\s/g, '_');
    },

    fieldName(id) {
      let f = this.fields.find((f) => f.id === id);
      if (f) {
        return f.name || f.id;
      }
      return '';
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
            let f = this.fields.find((f) => f.id === h);
            if (f) {
              mapping[h] = f.id;
            }
            return mapping;
          }, {});
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

