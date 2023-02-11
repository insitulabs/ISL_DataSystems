// import { createApp } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';
import { createApp } from '/assets/lib/vue.esm-browser.js';

let beforeUnloadListener = null;

createApp({
  delimiters: ['${', '}'],
  data() {
    // TODO revisit
    let data = window._view;

    // TODO maybe query for this some day to avoid large datasets of sources
    let allSources = window._allSources.results;

    return {
      tab: 'edit',
      id: data._id,
      deleted: data.deleted,
      name: data.name,
      note: data.note || '',
      fields: data.fields,
      sources: data.sources,
      editingFieldIndex: null,
      editingFieldName: null,
      editingSource: {
        id: null,
        fields: [],
        sample: null,
        selected: [],
        fieldSearch: ''
      },
      allSources: allSources,
      newSource: null,
      saving: false,
      error: null,
      loadingPreview: false,
      dirty: false
    };
  },

  computed: {
    isNew() {
      return !this.id;
    },
    isDeleted() {
      return this.deleted === true;
    },
    invalidField() {
      let invalid = this.sources.reduce((invalid, s) => {
        for (const [sourceField, viewField] of Object.entries(s.rename)) {
          if (viewField && !this.fields.some((f) => f.name === viewField)) {
            invalid[s.source + sourceField] = true;
          }
        }
        return invalid;
      }, {});
      return invalid;
    },

    editingSourceVisibleFields() {
      if (this.editingSource.fieldSearch) {
        let search = this.editingSource.fieldSearch.toLowerCase();
        return this.editingSource.fields.filter((f) => {
          if (f.id.toLowerCase().includes(search)) {
            return true;
          }
          if (f.name) {
            return f.name.toLowerCase().includes(search);
          }
          return false;
        });
      } else {
        return this.editingSource.fields;
      }
    },

    editingSourceSample() {
      if (typeof this.editingSource?.sample?.index === 'number') {
        return this.editingSource.sample.results[this.editingSource.sample.index];
      }
      return null;
    },

    availableSources() {
      let bySystem = {};
      let sources = this.allSources.filter((s) => {
        return !this.sources.find((existingSource) => existingSource.source === s._id);
      });

      sources.forEach((s) => {
        if (!bySystem[s.system]) {
          bySystem[s.system] = [];
        }
        bySystem[s.system].push(s);
      });

      Object.values(bySystem).forEach((sources) => {
        sources.sort((a, b) => {
          return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
      });

      return bySystem;

      // return this.allSources.filter((s) => {
      //   return !this.sources.find((existingSource) => existingSource.source === s._id);
      // });
    }
  },

  mounted() {
    let $sourceFieldsModal = document.getElementById('source-fields-modal');
    this.sourceFieldsModal = new bootstrap.Modal($sourceFieldsModal, {
      // keyboard: false
      focus: false
    });
    $sourceFieldsModal.addEventListener('shown.bs.modal', (event) => {
      this.$refs.editingSourceFields.scrollTop = 0;
      this.$refs.editingSourceFieldSearch.select();
    });

    this.newSourceModal = new bootstrap.Modal('#new-source-modal', {
      // keyboard: false
      focus: false
    });

    let $editFieldModal = document.getElementById('edit-field-modal');
    this.editFieldModal = new bootstrap.Modal($editFieldModal, {
      // keyboard: false
      focus: false
    });
    $editFieldModal.addEventListener('shown.bs.modal', () => {
      this.$refs.editingFieldName.select();
    });
    $editFieldModal.addEventListener('hide.bs.modal', () => {
      this.editingFieldIndex = null;
      this.editingFieldName = null;
    });

    let $preview = document.getElementById('preview');
    $preview.addEventListener('click', (event) => {
      let link = event.target.closest('a');
      if (link) {
        event.preventDefault();
        let query = '';
        let href = link.getAttribute('href');
        let queryIndex = href.indexOf('?');
        if (queryIndex > -1) {
          query = href.substring(queryIndex);
        }
        this.generatePreview(query);
      }
    });
  },

  watch: {
    tab() {
      if (this.tab === 'preview') {
        this.generatePreview();
      }
    },
    name() {
      this.dirty = true;
    },
    fields: {
      deep: true,
      handler: function () {
        this.dirty = true;
      }
    },
    sources: {
      deep: true,
      handler: function () {
        this.dirty = true;
      }
    },
    dirty(value) {
      if (value && !beforeUnloadListener) {
        beforeUnloadListener = (event) => {
          event.preventDefault();
          return (event.returnValue = 'Are you sure you want to exit without saving?');
        };
        window.addEventListener('beforeunload', beforeUnloadListener, { capture: true });
      } else if (!value && beforeUnloadListener) {
        window.removeEventListener('beforeunload', beforeUnloadListener, { capture: true });
        beforeUnloadListener = null;
      }
    }
  },

  methods: {
    addField($event) {
      let value = $event.target.value.trim();

      // Make sure field isn't a reserved word.
      if (['_id', 'id', 'created', 'imported'].includes(value)) {
        value = null;
      }

      if (value) {
        let lowered = value.toLowerCase();
        if (!this.fields.some((f) => lowered === f.name.toLowerCase())) {
          this.fields.push({ name: value });
          $event.target.value = '';
          $event.target.classList.remove('is-invalid');
          return;
        }
      }
      $event.target.classList.add('is-invalid');
    },

    getSource(id) {
      return this.sources.find((s) => s.source._id === id);
    },

    deleteSource(id) {
      if (confirm('Are you sure you want to remove this source?')) {
        this.sources = this.sources.filter((s) => s.source._id !== id);
      }
    },

    selectSourceFields(sourceId) {
      let source = this.getSource(sourceId);
      if (!source) {
        return;
      }

      this.editingSource.id = sourceId;
      $api('/api/source/' + sourceId + '/fields-with-sample')
        .then((data) => {
          this.editingSource.fields = data.source.fields;
          this.editingSource.sample = data.sample;
          if (data.sample.results.length) {
            this.editingSource.sample.index = 0;
          }
          this.editingSource.selected = Object.keys(source.rename);
          this.sourceFieldsModal.show();
        })
        .catch((err) => {
          // TODO
          console.error(err);
          this.error = err.message ? err.message : 'Error encountered source lookup.';
        });
    },

    checkAllEditingSourceFields() {
      this.editingSource.selected = this.editingSourceVisibleFields.slice(0);
    },

    checkNoneEditingSourceFields() {
      this.editingSource.selected = this.editingSource.selected.filter((f) => {
        return !this.editingSourceVisibleFields.includes(f);
      });
    },

    onSaveSource() {
      let source = this.getSource(this.editingSource.id);
      if (!source) {
        return;
      }

      let updatedRename = {};
      this.editingSource.selected.sort((a, b) => {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });

      this.editingSource.selected.forEach((field) => {
        updatedRename[field] = source.rename[field] || null;
      });

      source.rename = updatedRename;

      this.sourceFieldsModal.hide();
    },

    generatePreview(params = '') {
      this.loadingPreview = true;
      $api('/data-viewer/view-preview' + params, {
        method: 'POST',
        body: JSON.stringify({
          fields: this.fields,
          sources: this.sources
        })
      })
        .then((preview) => {
          this.loadingPreview = false;
          this.$refs.preview.innerHTML = preview;
          window.scrollTo(0, 0);
        })
        .catch((err) => {
          console.error(err);
          this.$refs.preview.innerHTML = '';
          this.error = err.message ? err.message : 'Error encountered during preview.';
          this.loadingPreview = false;
        });
    },

    showNewSourceModal() {
      this.newSourceModal.show();
    },

    addSource() {
      if (this.newSource) {
        this.sources.push({
          source: this.newSource,
          rename: {}
        });

        this.newSource = null;
        this.newSourceModal.hide();
      }
    },

    /**
     * Increase the index of which sample record we're looking at.
     */
    nextEditingSourceSample() {
      if (this.editingSource.sample) {
        let next = this.editingSource.sample.index + 1;
        if (next === this.editingSource.sample.results.length) {
          next = 0;
        }
        this.editingSource.sample.index = next;
      }
    },

    save() {
      if (this.saving) {
        return;
      }

      this.saving = true;
      this.error = null;
      let isUpdate = this.id;
      let url = isUpdate ? `/api/view/${this.id}` : '/api/view';
      let method = isUpdate ? 'PUT' : 'POST';

      let body = {
        name: this.name.trim(),
        note: this.note.trim(),
        fields: this.fields,
        sources: this.sources
      };
      if (this.id) {
        body._id = this.id;
      }

      $api(url, {
        method,
        body: JSON.stringify(body)
      })
        .then((data) => {
          this.id = data._id;
          this.name = data.name;
          this.note = data.note;
          this.fields = data.fields;
          this.sources = data.sources;
          if (!this.isUpdate) {
            window.history.replaceState(null, '', `/data-viewer/view/${this.id}/edit`);
          }

          this.$nextTick(() => {
            this.dirty = false;
          });
        })
        .catch((err) => {
          // TODO
          console.error(err);
          this.error = err.message ? err.message : 'Error encountered during saving.';
        })
        .finally(() => {
          this.saving = false;
        });
    },

    /**
     * Open the edit modal for the provided field.
     * @param {Object} field
     * @param {Number} index
     */
    editField(field, index) {
      this.editingFieldIndex = index;
      this.editingFieldName = field.name;
      this.$refs.editingFieldName.classList.remove('is-invalid');
      this.editFieldModal.show();
    },

    /**
     * Save field name button handler.
     */
    updateField() {
      let invalid = !this.editingFieldName || this.editingFieldName.length === 0;
      invalid =
        invalid ||
        this.fields.some((f, index) => {
          return index !== this.editingFieldIndex && f.name === this.editingFieldName;
        });

      if (invalid) {
        this.$refs.editingFieldName.classList.add('is-invalid');
        return;
      }

      let previousFieldName = this.fields[this.editingFieldIndex].name;
      if (previousFieldName !== this.editingFieldName) {
        this.fields[this.editingFieldIndex].name = this.editingFieldName;
        this.sources.forEach((s) => {
          for (const [sourceField, viewField] of Object.entries(s.rename)) {
            if (viewField === previousFieldName) {
              s.rename[sourceField] = this.editingFieldName;
            }
          }
        });
      }
      this.editFieldModal.hide();
    },

    deleteField(field, index) {
      if (field.id) {
        // TODO
        alert('Deleting previously saved fields is not supported at this time');
        return;
      }

      this.sources.forEach((s) => {
        for (const [sourceField, viewField] of Object.entries(s.rename)) {
          if (viewField === field.name) {
            s.rename[sourceField] = null;
          }
        }
      });

      this.fields.splice(index, 1);
    },

    moveField(index, increment) {
      this.fields.splice(index + increment, 0, this.fields.splice(index, 1)[0]);
    },

    getFieldName(viewSource, field) {
      let source = this.allSources.find((s) => {
        return s.submissionKey === viewSource.submissionKey;
      });
      if (source) {
        let sourceField = source.fields.find((f) => f.id === field);
        if (sourceField && sourceField.name) {
          return sourceField.name;
        }
      }

      return field;
    },

    /**
     * On source delete click.
     * @param {Event} event
     */
    onDeleteForm(event) {
      if (!window.confirm('Are you sure you want to delete this view?')) {
        event.preventDefault();
      }
    }
  }
}).mount('#app');

