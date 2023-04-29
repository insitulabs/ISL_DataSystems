Vue.createApp({
  delimiters: ['${', '}'],
  data() {
    return {
      destinationId: null,
      destinationFields: [],
      destinationSamples: [],
      destinationSampleIndex: 0,
      loading: false,
      mapping: {},
      source: window._source,
      submissions: window._submissions.slice(0),
      submissionIndex: 0,
      saving: false,
      error: window._sources.length === 0 ? 'Access denied. No editable sources.' : null,
      created: null,
      fieldSearch: ''
    };
  },

  computed: {
    submission() {
      return this.submissions[this.submissionIndex].data;
    },

    destinationSample() {
      if (this.destinationSamples.length > this.destinationSampleIndex) {
        return this.destinationSamples[this.destinationSampleIndex];
      }

      return {};
    },

    availableDestinationFields() {
      return this.destinationFields.filter((f) => {
        return !Object.values(this.mapping).includes(f.id);
      });
    },

    mappedDestinationFields() {
      return Object.values(this.mapping).reduce((obj, fieldId) => {
        obj[fieldId] = true;
        return obj;
      }, {});
    },

    invalidFields() {
      let invalid = {};
      Object.keys(this.mapping).forEach((id) => {
        if (this.mapping[id] && !this.destinationFields.find((df) => df.id === this.mapping[id])) {
          invalid[id] = true;
        }
      });
      return invalid;
    },

    canSave() {
      if (!this.destinationId) {
        return false;
      }

      if (!Object.keys(this.mapping).length) {
        return false;
      }

      if (Object.keys(this.invalidFields).length > 0) {
        return false;
      }

      return true;
    },

    visibleSubmissionIndexes() {
      let maxPages = 10;
      let currentPage = this.submissionIndex + 1;
      let totalPages = this.submissions.length;

      // ensure current page isn't out of range
      if (currentPage < 1) {
        currentPage = 1;
      } else if (currentPage > totalPages) {
        currentPage = totalPages;
      }

      let startPage, endPage;
      if (totalPages <= maxPages) {
        // total pages less than max so show all pages
        startPage = 1;
        endPage = totalPages;
      } else {
        // total pages more than max so calculate start and end pages
        let maxPagesBeforeCurrentPage = Math.floor(maxPages / 2);
        let maxPagesAfterCurrentPage = Math.ceil(maxPages / 2) - 1;
        if (currentPage <= maxPagesBeforeCurrentPage) {
          // current page near the start
          startPage = 1;
          endPage = maxPages;
        } else if (currentPage + maxPagesAfterCurrentPage >= totalPages) {
          // current page near the end
          startPage = totalPages - maxPages + 1;
          endPage = totalPages;
        } else {
          // current page somewhere in the middle
          startPage = currentPage - maxPagesBeforeCurrentPage;
          endPage = currentPage + maxPagesAfterCurrentPage;
        }
      }

      // create an array of pages to ng-repeat in the pager control
      return Array.from(Array(endPage + 1 - startPage).keys()).map((i) => startPage + i);
    }
  },

  watch: {
    destinationId(id) {
      this.mapping = {};
      this.selectSourceFields(id);
    },

    /**
     * Watch mappings and remove sequence typed fields.
     */
    mapping: {
      deep: true,
      handler() {
        Object.keys(this.mapping).forEach((id) => {
          if (this.mapping[id]) {
            let field = this.destinationFields.find((df) => df.id === this.mapping[id]);
            if (field && field.meta && field.meta.type === 'sequence') {
              delete this.mapping[id];
            }
          }
        });
      }
    }
  },

  methods: {
    selectSourceFields(sourceId) {
      this.loading = true;
      this.error = null;
      $api('/api/source/' + sourceId + '/fields-with-sample')
        .then((data) => {
          this.destinationFields = data.source.fields;
          this.destinationSamples = data.sample && data.sample.results ? data.sample.results : [];
          if (!this.destinationFields.length) {
            this.error = 'Invalid destination. No fields found on source.';
          }

          this.source.fields.forEach((f) => {
            let df = this.destinationFields.find((df) => df.id === f.id);
            if (df && df?.meta?.type !== 'sequence') {
              this.mapping[f.id] = df.id;
            }
          });
        })
        .catch((err) => {
          console.error(err);
          this.error = err.message ? err.message : 'Error encountered doing destination lookup.';
        })
        .finally(() => {
          this.loading = false;
        });
    },

    nextSubmission() {
      if (this.submissionIndex + 1 < this.submissions.length) {
        this.submissionIndex++;
      } else {
        this.submissionIndex = 0;
      }
    },

    nextDestinationSample() {
      if (this.destinationSampleIndex + 1 < this.destinationSamples.length) {
        this.destinationSampleIndex++;
      } else {
        this.destinationSampleIndex = 0;
      }
    },

    destinationFieldName(id) {
      let field = this.destinationFields.find((df) => df.id === id);
      if (field) {
        return field.name || field.id;
      }

      return '';
    },

    save() {
      if (!this.canSave && this.saving) {
        return;
      }

      this.saving = true;
      let toCopy = this.submissions.map((s) => {
        let dto = {};
        for (const [sourceField, destField] of Object.entries(this.mapping)) {
          dto[destField] = s.data[sourceField];
        }

        return dto;
      });

      $api(`/api/source/${this.destinationId}/submission`, {
        method: 'POST',
        body: JSON.stringify(toCopy)
      })
        .then((created) => {
          this.created = created;
        })
        .catch((error) => {
          alert(error && error.message ? error.message : error);
        })
        .finally(() => {
          this.saving = false;
        });
    },

    done() {
      if (window && window.parent) {
        window.parent.postMessage({
          action: 'done-copy-to'
        });
      }
    },

    hideField(id, name) {
      let fieldSearch = this.fieldSearch.toLowerCase();
      if (!fieldSearch) {
        return false;
      }

      if (id.toLowerCase().includes(fieldSearch)) {
        return false;
      }

      if (name.toLowerCase().includes(fieldSearch)) {
        return false;
      }

      return true;
    }
  }
}).mount('#app');

