Vue.createApp({
  delimiters: ['${', '}'],
  data() {
    return {
      inflightUndo: {},
      undone: {}
    };
  },

  mounted() {},

  methods: {
    promptUndo(id) {
      if (confirm('Are you sure you want to undo this operation?')) {
        this.inflightUndo[id] = true;
        $api(`/api/audit/undo/${id}`, {
          method: 'POST'
        })
          .then((resp) => {
            this.undone[id] = true;
          })
          .catch((error) => {
            alert(error.message);
          })
          .finally(() => {
            delete this.inflightUndo[id];
          });
      }
    }
  }
}).mount('#app');

