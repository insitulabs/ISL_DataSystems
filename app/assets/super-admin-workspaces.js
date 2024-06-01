import { langs } from './lib/langs.js';
const PRIMARY_LANG = 'en';

Vue.createApp({
  delimiters: ['${', '}'],
  data() {
    return {
      error: null,
      saveError: null,
      saving: false,
      editingWorkspace: null,
      newLanguage: null
    };
  },

  computed: {
    /**
     * The selected languages as an array.
     * @return {Array}
     */
    selectedLanguages() {
      if (!this.editingWorkspace) {
        return [];
      }

      let active = this.editingWorkspace.languages.map((id) => {
        let l = langs[id];
        l.id = id;
        return l;
      });
      active.sort((a, b) => {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      let primary = langs[PRIMARY_LANG];
      primary.isPrimary = true;
      primary.id = PRIMARY_LANG;
      active.unshift(primary);
      return active;
    },

    /**
     * Get the list of languages available to be added.
     * @return {Object}
     */
    availableLanguages() {
      let avail = { ...langs };
      delete avail[PRIMARY_LANG];

      if (!this.editingWorkspace) {
        return avail;
      }

      this.editingWorkspace.languages.forEach((lang) => {
        delete avail[lang];
      });

      // Sort languages by english name.
      return Object.keys(avail)
        .sort((a, b) => {
          return avail[a].name.toLowerCase().localeCompare(avail[b].name.toLowerCase());
        })
        .reduce((sorted, lang) => {
          sorted[lang] = avail[lang];
          return sorted;
        }, {});
    }
  },

  mounted() {
    let $editModal = document.getElementById('edit-modal');
    this.editModal = new bootstrap.Modal($editModal, {
      focus: true
    });
    $editModal.addEventListener('shown.bs.modal', (event) => {
      $editModal.querySelector('input[name=name]').select();
    });
  },

  methods: {
    /**
     * Show the modal for editing or creating a workspace.
     * @param {Event} event The click event.
     */
    editWorkspace(event) {
      let workspace = {
        name: '',
        id: null,
        languages: []
      };
      this.newLanguage = null;

      if (event) {
        let tr = event.target.closest('tr');
        if (tr) {
          workspace.id = tr.dataset.id;
          workspace.name = tr.dataset.name;
          if (tr.dataset.languages) {
            workspace.languages = tr.dataset.languages.split(',');
          }
        }
      }

      this.error = null;
      this.saveError = null;
      this.editingWorkspace = workspace;
      this.editModal.show();
    },

    deleteWorkspace(event) {
      if (event) {
        let tr = event.target.closest('tr');
        if (tr) {
          if (!confirm(`Are you sure you want to remove ${tr.dataset.name}?`)) {
            return;
          }
          $api('/super-admin/api/workspace', {
            method: 'DELETE',
            body: JSON.stringify(tr.dataset)
          })
            .then(() => {
              window.location.reload();
            })
            .catch((err) => {
              console.error(err);
              this.error = err.message ? err.message : 'Error encountered deleting workspace.';
            })
            .finally(() => {
              this.saving = false;
            });
        }
      }
    },

    /**
     * Save or Create the current workspace.
     */
    saveWorkspace() {
      this.saving = true;
      this.saveError = null;
      $api('/super-admin/api/workspace', {
        method: 'POST',
        body: JSON.stringify(this.editingWorkspace)
      })
        .then(() => {
          window.location.reload();
        })
        .catch((err) => {
          console.error(err);
          this.saveError = err.message ? err.message : 'Error encountered saving workspace.';
        })
        .finally(() => {
          this.saving = false;
        });
    },

    /**
     * Add the selected language to the editing workspace.
     */
    addLanguage() {
      if (this.newLanguage && this.editingWorkspace) {
        this.editingWorkspace.languages.push(this.newLanguage);
        this.editingWorkspace.languages.sort((a, b) => {
          return a.toLowerCase().localeCompare(b.toLowerCase());
        });

        this.newLanguage = null;
      }
    },

    /**
     * Remove the language to the editing workspace.
     * @param {String} id Language ID.
     */
    deleteLanguage(id) {
      if (this.editingWorkspace) {
        let name = langs[id]?.name || id;
        if (window.confirm(`Are you sure you want to remove ${name}`)) {
          this.editingWorkspace.languages = this.editingWorkspace.languages.filter((l) => l !== id);
        }
      }
    }
  }
}).mount('#app');

