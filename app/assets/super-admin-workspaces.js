import { createApp } from '/assets/lib/vue.esm-browser.js';

createApp({
  delimiters: ['${', '}'],
  data() {
    return {
      error: null,
      saveError: null,
      saving: false,
      editingWorkspace: null
    };
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
    getWorkspaceUrl(name) {
      let host = window.location.host.split('.');
      host.shift();
      return window.location.protocol + '//' + name + '.' + host.join('.');
    },

    editWorkspace(event) {
      let workspace = {
        name: '',
        id: null
      };

      if (event) {
        let tr = event.target.closest('tr');
        if (tr) {
          workspace.id = tr.dataset.id;
          workspace.name = tr.dataset.name;
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
    }
  }
}).mount('#app');

