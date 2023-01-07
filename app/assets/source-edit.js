// import { createApp } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';
import { createApp } from '/assets/lib/vue.esm-browser.js';

let beforeUnloadListener = null;

createApp({
  delimiters: ['${', '}'],
  data() {
    // TODO revisit... cachcing, back button issues?
    let data = window._source;
    let samples = window._samples;

    return {
      tab: 'edit',
      id: data._id,
      system: data.system,
      namespace: data.namespace,
      name: data.name,
      note: data.note,
      fields: data.fields,
      saving: false,
      error: null,
      loadingPreview: false,
      dirty: false,
      fieldSearch: '',
      samples: samples,
      sampleIndex: 0
    };
  },

  computed: {
    isNew() {
      return !this.id;
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
    }
  },

  watch: {
    name() {
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
    addField($event) {
      let value = $event.target.value.trim();
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

        if (id && !this.fields.some((f) => id === f.id.toLowerCase())) {
          this.fields.push({ id: id, name: value });
          $event.target.value = '';
          $event.target.classList.remove('is-invalid');
          return;
        }
      }
      $event.target.classList.add('is-invalid');
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

      this.saving = true;
      this.error = null;

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
    }
  }
}).mount('#app');

