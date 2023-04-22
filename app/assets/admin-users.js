Vue.createApp({
  delimiters: ['${', '}'],
  data() {
    return {
      error: null,
      saveError: null,
      saving: false,
      editingUser: null,
      editingUserTab: 'sources',
      editingUserSources: null,
      editingUserViews: null,
      editingUserAccessFilter: null
    };
  },

  computed: {
    editingUserAccess() {
      let list = null;
      if (this.editingUserTab === 'sources') {
        list = this.editingUserSources;
      } else {
        list = this.editingUserViews;
      }

      if (this.editingUserAccessFilter) {
        let query = this.editingUserAccessFilter.toLowerCase();
        return list.filter((item) => {
          return item.name.toLowerCase().includes(query);
        });
      }

      return list;
    },

    editingUserSourceAccess() {
      if (this.editingUserSources) {
        return this.editingUserSources.filter((s) => s.read);
      }
      return [];
    },

    editingUserViewAccess() {
      if (this.editingUserViews) {
        return this.editingUserViews.filter((s) => s.read);
      }
      return [];
    }
  },

  mounted() {
    let $editModal = document.getElementById('edit-modal');
    this.editModal = new bootstrap.Modal($editModal, {
      focus: true
    });
    $editModal.addEventListener('hide.bs.modal', (event) => {
      $editModal.querySelector('.acl-list').scrollTop = 0;
    });
    $editModal.addEventListener('shown.bs.modal', (event) => {
      if (!this.editingUser.email) {
        $editModal.querySelector('input[name=email]').select();
      }
    });

    this.$refs.users.addEventListener('click', (event) => {
      if (event.target.closest('.edit-user')) {
        let tr = event.target.closest('tr');
        this.edit(tr.dataset.id);
      }
    });

    // Deleted user toggle
    document.getElementById('included-deleted-switch').addEventListener('change', (event) => {
      if (event.target.checked) {
        window.location = window.location.pathname + '?deleted=true';
      } else {
        window.location = window.location.pathname;
      }
    });
  },

  methods: {
    edit(userId) {
      this.error = null;
      this.saveError = null;
      let url = userId ? `/api/user/${userId}` : '/api/user/new';
      $api(url)
        .then((response) => {
          this.editingUser = response.user;
          this.editingUserSources = response.sources;
          this.editingUserViews = response.views;
          this.editingUserTab = 'sources';
          this.editModal.show();
        })
        .catch((err) => {
          this.error = err.message ? err.message : 'Error encountered fetching user.';
        });
    },

    onWriteCheck(index) {
      setTimeout(() => {
        if (this.editingUserAccess[index].write) {
          this.editingUserAccess[index].read = true;
        }
      }, 0);
    },

    saveUser() {
      let toPersist = {
        ...this.editingUser,
        sources: this.editingUserSourceAccess,
        views: this.editingUserViewAccess
      };
      this.saving = true;
      this.saveError = null;
      $api('/api/user', {
        method: 'POST',
        body: JSON.stringify(toPersist)
      })
        .then((response) => {
          this.editingUser = null;
          this.editingUserSources = null;
          this.editingUserViews = null;
          this.editModal.hide();

          let $user = null;
          if (toPersist._id) {
            $user = this.$refs.users.querySelector(`tr[data-id="${toPersist._id}"]`);
          }
          if (!$user) {
            $user = document.createElement('tr');
            this.$refs.users.querySelector('tbody').prepend($user);
          }

          $user.outerHTML = response;
        })
        .catch((err) => {
          console.error(err);
          this.saveError = err.message ? err.message : 'Error encountered fetching user.';
        })
        .finally(() => {
          this.saving = false;
        });
    }
  }
}).mount('#app');

