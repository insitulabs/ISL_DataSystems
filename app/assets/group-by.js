const OPERATIONS_W_FIELDS = ['sum'];

Vue.createApp({
  delimiters: ['${', '}'],
  data() {
    let source = window._source;
    let params = new URLSearchParams(window.location.search);
    let keys = params.getAll('__key');
    keys = keys.filter((key) => {
      return source.fields.find((f) => f.id === key);
    });
    params.delete('__key');
    params.delete('offset');
    params.delete('order');
    params.delete('sort');

    let operationCommand = '';
    let operationField = null;
    if (window._operation) {
      let parts = window._operation.split(':');
      operationCommand = parts[0] || '';
      if (OPERATIONS_W_FIELDS.includes(operationCommand)) {
        operationField = parts[1];
      }
    }

    return {
      pageParams: params,
      source,
      keys,
      operationCommand,
      operationField,
      fieldSearch: null
    };
  },

  computed: {
    visibleSourceFields() {
      let query = this.fieldSearch ? this.fieldSearch.trim().toLowerCase() : '';
      if (query) {
        return this.source.fields.filter((f) => {
          return f?.name?.toLowerCase().includes(query) || f.id.toLowerCase().includes(query);
        });
      }

      return this.source.fields;
    },

    queryParams() {
      let params = new URLSearchParams(this.pageParams.toString());
      this.keys.forEach((k) => {
        params.append('__key', k);
      });

      if (this.operation) {
        params.set('__operation', this.operation);
      }

      return params;
    },

    disabledOperationField() {
      return !this.operationCommand || !OPERATIONS_W_FIELDS.includes(this.operationCommand);
    },

    /**
     * @return {boolean} True if the operation field is set, required, and isn't valid field.
     */
    invalidOperationField() {
      return (
        this.operationField &&
        !this.disabledOperationField &&
        !this.source.fields.some((f) => f.id === this.operationField)
      );
    },

    /**
     *
     * @return {string} Return the operation to group by.
     */
    operation() {
      if (this.operationCommand) {
        let parts = [this.operationCommand];
        if (OPERATIONS_W_FIELDS.includes(this.operationCommand)) {
          if (!this.operationField || this.invalidOperationField) {
            return false;
          }
          parts.push(this.operationField);
        } else {
          parts.push('*');
        }

        return parts.join(':');
      }

      return false;
    }
  },

  watch: {
    queryParams() {
      // let url = window.location.pathname;
      // if (this.queryParams.size) {
      //   window.location.href = url + '?' + this.queryParams.toString();
      // } else {
      //   window.location.href = url;
      // }
    },

    operationCommand(value, previous) {
      if (this.disabledOperationField) {
        this.operationField = null;
      }
    }
  },

  methods: {
    selectSearchFields() {
      this.$nextTick(() => {
        if (this.$refs.fieldSearch) {
          this.$refs.fieldSearch.select();
        }
      });
    },

    execute() {
      let url = window.location.pathname;
      if (this.queryParams.size) {
        window.location.href = url + '?' + this.queryParams.toString();
      } else {
        window.location.href = url;
      }

      window.parent.postMessage({
        action: 'copy-to-updates',
        updates
      });
    },

    /**
     * Get the name of a field if it has one. Otherwise return the ID.
     * @param {string} id Field ID.
     * @return {string}
     */
    fieldName(id) {
      let field = this.source.fields.find((f) => f.id === id);
      return field ? field.name || field.id : id;
    },

    /**
     * Remove the key.
     * @param {string} key
     */
    removeKey(key) {
      this.keys = this.keys.filter((k) => k !== key);
    }
  }
}).mount('#app');

