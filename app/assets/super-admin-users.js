import { createApp } from '/assets/lib/vue.esm-browser.js';

createApp({
  delimiters: ['${', '}'],
  data() {
    return {
      error: null,
      saveError: null,
      saving: false,
      editingUser: null
    };
  },

  mounted() {
    let $editModal = document.getElementById('edit-modal');
    this.editModal = new bootstrap.Modal($editModal, {
      focus: true
    });
    $editModal.addEventListener('shown.bs.modal', (event) => {
      if (!this.editingUser.email) {
        $editModal.querySelector('input[name=email]').select();
      }
    });
  },

  methods: {
    editUser(event) {
      let user = {
        email: '',
        name: '',
        id: null
      };

      if (event) {
        let tr = event.target.closest('tr');
        if (tr) {
          user.id = tr.dataset.id;
          user.email = tr.dataset.email;
          user.name = tr.dataset.name;
        }
      }

      this.error = null;
      this.saveError = null;
      this.editingUser = user;
      this.editModal.show();
    },

    deleteUser(event) {
      if (event) {
        let tr = event.target.closest('tr');
        if (tr) {
          if (!confirm(`Are you sure you want to remove ${tr.dataset.email}?`)) {
            return;
          }
          $api('/super-admin/api/user', {
            method: 'DELETE',
            body: JSON.stringify(tr.dataset)
          })
            .then((response) => {
              window.location.reload();
            })
            .catch((err) => {
              console.error(err);
              this.error = err.message ? err.message : 'Error encountered deleting user.';
            })
            .finally(() => {
              this.saving = false;
            });
        }
      }
    },

    saveUser() {
      this.saving = true;
      this.saveError = null;
      $api('/super-admin/api/user', {
        method: 'POST',
        body: JSON.stringify(this.editingUser)
      })
        .then((response) => {
          window.location.reload();
        })
        .catch((err) => {
          console.error(err);
          this.saveError = err.message ? err.message : 'Error encountered saving user.';
        })
        .finally(() => {
          this.saving = false;
        });
    }
  }
}).mount('#app');

