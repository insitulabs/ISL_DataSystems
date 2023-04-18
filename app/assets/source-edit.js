import { createApp } from '/assets/lib/vue.esm-browser.js';

let beforeUnloadListener = null;

createApp({
  delimiters: ['${', '}'],
  data() {
    // TODO revisit... cachcing, back button issues?
    let data = window._source;
    let samples = window._samples;

    // TODO maybe query for this some day to avoid large datasets of sources
    let allSources = window._allSources.results;

    data.fields.forEach((f) => {
      f.meta.type = f.meta.type || '';
    });

    return {
      tab: 'edit',
      id: data._id,
      deleted: data.deleted,
      system: data.system,
      namespace: data.namespace,
      name: data.name,
      note: data.note,
      fields: data.fields.slice(),
      persistedFields: data.fields.slice(),
      saving: false,
      saved: false,
      error: null,
      loadingPreview: false,
      dirty: false,
      fieldSearch: '',
      samples: samples,
      sampleIndex: 0,
      allSources,
      permissions: data.permissions || {},
      permissionsSaved: false
    };
  },

  computed: {
    isNew() {
      return !this.id;
    },
    isDeleted() {
      return this.deleted === true;
    },
    sample() {
      if (this.samples && this.samples.length) {
        return this.samples[this.sampleIndex];
      }
      return {};
    },
    hasMoreSamples() {
      return this.samples && this.samples.length > 1;
    },
    visibleFields() {
      if (this.fieldSearch) {
        let search = this.fieldSearch.toLowerCase();
        return this.fields.filter((f) => {
          if (f.id.toLowerCase().includes(search)) {
            return true;
          }
          if (f.name) {
            return f.name.toLowerCase().includes(search);
          }
          return false;
        });
      } else {
        return this.fields;
      }
    },
    filteringFields() {
      return !!this.fieldSearch;
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
    newFieldIds() {
      return this.fields
        .filter((f) => {
          return !this.persistedFields.find((persisted) => persisted.id === f.id);
        })
        .map((f) => f.id);
    }
  },

  watch: {
    name() {
      this.dirty = true;
    },
    note() {
      this.dirty = true;
    },
    fields: {
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
    addField() {
      let $input = this.$refs.addField;
      let value = $input.value.trim();
      if (value) {
        let lowered = value.toLowerCase();
        let id = lowered
          .replace(/\s+/g, ' ')
          .replace(/\./g, '__')
          .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '');

        // Make sure id isn't just underscores
        if (!id.replace(/_/g, '')) {
          id = null;
        }

        // Make sure field isn't a reserved word.
        if (['_id', 'id', 'created', 'imported'].includes(id)) {
          id = null;
        }

        if (id && !this.fields.some((f) => id === f.id.toLowerCase())) {
          this.fields.push({ id: id, name: value, meta: {} });
          $input.value = '';
          $input.classList.remove('is-invalid');
          this.fieldSearch = '';
          return;
        }
      }
      $input.classList.add('is-invalid');
    },

    updateFieldName(id, $event) {
      let name = $event.target.value.trim();
      let field = this.fields.find((f) => f.id === id);
      if (field) {
        field.name = name;
      }
    },

    moveField(index, increment) {
      this.fields.splice(index + increment, 0, this.fields.splice(index, 1)[0]);
    },

    /**
     * Increase the index of which sample record we're looking at.
     */
    nextSample() {
      let next = this.sampleIndex + 1;
      if (next >= this.samples.length) {
        next = 0;
      }
      this.sampleIndex = next;
    },

    save() {
      if (this.saving) {
        return;
      }

      this.cleanFieldTypes();

      this.saving = true;
      this.error = null;
      this.saved = false;

      // TODO Finish new source
      let isUpdate = this.id;
      let url = isUpdate ? `/api/source/${this.id}` : '/api/source';
      let method = isUpdate ? 'PUT' : 'POST';

      let body = {
        system: this.system,
        namespace: this.namespace,
        name: this.name.trim(),
        note: this.note ? this.note.trim() : null,
        fields: this.fields
      };
      if (this.id) {
        body._id = this.id;
      }

      $api(url, {
        method,
        body: JSON.stringify(body)
      })
        .then((data) => {
          this.saved = true;
          this.id = data._id;
          this.name = data.name;
          this.note = data.note;
          this.fields = data.fields;
          if (!this.isUpdate) {
            window.history.replaceState(null, '', `/data-viewer/source/${this.id}/edit`);
          }

          this.$nextTick(() => {
            this.dirty = false;
          });
        })
        .catch((err) => {
          // TODO
          console.error(err);
          this.error = err.message ? err.message : 'Error encountered during save.';
        })
        .finally(() => {
          this.saving = false;
        });
    },

    deleteField(field) {
      if (!this.newFieldIds.includes(field.id)) {
        if (
          !confirm(
            'Are you sure you want to delete this field? ' +
              'Once saved, all data for this field will be lost. This cannot be undone.'
          )
        ) {
          return;
        }
      }

      this.fields = this.fields.filter((f) => f.id !== field.id);
    },

    /**
     * On source delete click.
     * @param {Event} event
     */
    onDeleteForm(event) {
      if (!window.confirm('Are you sure you want to archive this source?')) {
        event.preventDefault();
      }
    },

    /**
     * Cleanup field types and their meta data.
     */
    cleanFieldTypes() {
      this.fields.forEach((f) => {
        if (/source|view/.test(f.meta.type) && f.meta.originId) {
          // TODO revisit view.
          let validSource = this.allSources.find((s) => s._id === f.meta.originId);
          if (!validSource) {
            f.meta.originId = null;
            f.meta.originField = null;
          }
        } else {
          delete f.meta.originId;
          delete f.meta.originField;
        }
      });
    },

    /**
     * Does the field support meta options for it's type.
     * @param {Object} field
     * @return  {boolean}
     */
    hasMetaOptions(field) {
      return /source|view/.test(field?.meta?.type);
    },

    /**
     * Get source lookup name
     * @param {string} id The source id
     * @return {string}
     **/
    getSourceName(id) {
      if (id) {
        let validSource = this.allSources.find((s) => s._id === id);
        if (validSource) {
          return validSource.name;
        }
      }
      return null;
    },

    /**
     * Save the workspace permissions for this source.
     */
    savePermissions() {
      if (this.saving) {
        return;
      }

      this.saving = true;
      this.error = null;

      let body = {
        all: this.permissions,
        // TODO revisit
        users: null
      };

      $api(`/api/source/${this.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify(body)
      })
        .then(() => {
          this.saving = false;
          this.permissionsSaved = true;
        })
        .catch((err) => {
          console.error(err);
          this.error = err.message ? err.message : 'Error encountered during save.';
        })
        .finally(() => {
          this.saving = false;
        });
    }
  }
}).mount('#app');

