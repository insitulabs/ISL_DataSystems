// TODO return from backend or move all to __ prefix
const SYSTEM_PARAMS = ['table', 'sort', 'order', 'offset', 'limit', 'iframe'];

const OPERATIONS_W_FIELDS = ['avg', 'max', 'min', 'stdDev', 'sum'];
const VIEW_MODE = {
  ANALYZE: 'analyze',
  LIST: 'list'
};

const BASE_QUERY_PARAMS = ['sort', 'order', 'limit', 'offset', 'iframe'];

Vue.createApp({
  delimiters: ['${', '}'],
  data() {
    let fields = window._fields;
    let anaKeys = [];
    let anaOperationCommand = 'count';
    let anaOperationField = null;
    let params = new URLSearchParams(window.location.search);

    let baseParams = {};
    let anaBaseParams = {};

    let viewMode = params.get('__mode') === VIEW_MODE.ANALYZE ? VIEW_MODE.ANALYZE : VIEW_MODE.LIST;

    let currentQuery;
    if (viewMode === VIEW_MODE.LIST) {
      currentQuery = baseParams;
    } else {
      currentQuery = anaBaseParams;
    }

    for (let p of BASE_QUERY_PARAMS) {
      if (params.has(p)) {
        currentQuery[p] = params.get(p);
      }
    }

    if (viewMode === VIEW_MODE.ANALYZE) {
      anaKeys = params.getAll('__key').filter((key) => {
        return fields.find((f) => f.id === key);
      });
      if (params.has('__operation')) {
        let parts = params.get('__operation').split(':');
        anaOperationCommand = parts[0] || '';
        if (OPERATIONS_W_FIELDS.includes(anaOperationCommand)) {
          anaOperationField = parts[1];
        }
      }
    }

    let currentFilters = {};
    Array.from(new Set(params.keys()))
      .filter((key) => {
        if (SYSTEM_PARAMS.includes(key) || key.startsWith('__')) {
          return false;
        }

        return fields.some((f) => f.id === key);
      })
      .forEach((key) => {
        currentFilters[key] = params.getAll(key).filter(Boolean);
      });

    return {
      ORIGIN_TYPE: window._ORIGIN_TYPE,
      ORIGIN_ID: window._ORIGIN_ID,
      error: null,
      fields,
      viewMode,
      filterSearchInput: '',
      currentFilters,
      showDeleted: false,
      baseParams,
      anaBaseParams,
      anaError: null,
      anaKeys,
      anaOperationCommand,
      anaOperationField,
      anaFieldSearch: ''
    };
  },

  computed: {
    isListMode() {
      return this.viewMode === 'list';
    },

    isAnalyzeMode() {
      return !this.isListMode;
    },

    /**
     * @return {Array} The list of fields available to filter for.
     */
    availableFilterFields() {
      let query = this.filterSearchInput.toLowerCase();
      let available = this.fields.filter((f) => !this.currentFilters[f.id]);
      if (query) {
        available = available.filter((f) => {
          let haystack = ((f.name ? f.name : '') + ' ' + f.id).toLowerCase();
          return haystack.includes(query);
        });
      }

      return available;
    },

    /**
     * @return {Array} The list of fields available to analyze.
     */
    anaVisibleSourceFields() {
      let query = this.anaFieldSearch.toLowerCase();
      let available = this.fields;
      if (query) {
        available = available.filter((f) => {
          let haystack = ((f.name ? f.name : '') + ' ' + f.id).toLowerCase();
          return haystack.includes(query);
        });
      }

      return available;
    },

    /**
     * The list query params.
     * @return {URLSearchParams}
     */
    queryParams() {
      let params = new URLSearchParams(this.baseParams);
      if (this.showDeleted) {
        params.set('deleted', 1);
      }
      Object.keys(this.currentFilters).forEach((filter) => {
        this.currentFilters[filter].filter(Boolean).forEach((v) => {
          params.append(filter, v);
        });
      });
      params.sort();

      return params;
    },

    /**
     * The analyze query params.
     * @return {URLSearchParams}
     */
    anaQueryParams() {
      let params = new URLSearchParams(this.anaBaseParams);
      params.set('__mode', VIEW_MODE.ANALYZE);

      if (this.showDeleted) {
        params.set('deleted', 1);
      }

      this.anaKeys.forEach((k) => {
        params.append('__key', k);
      });

      if (this.anaOperation) {
        params.set('__operation', this.anaOperation);
      }

      Object.keys(this.currentFilters).forEach((filter) => {
        this.currentFilters[filter].filter(Boolean).forEach((v) => {
          params.append(filter, v);
        });
      });
      params.sort();

      return params;
    },

    /**
     *
     * @return {boolean} True if we have valid analyze query operations.
     */
    validAnaParams() {
      return this.anaKeys.length > 0 && this.anaOperation;
    },

    /**
     * @return {boolean} True if analyze operation field isn't required.
     */
    anaDisabledOperationField() {
      return !this.anaOperationCommand || !OPERATIONS_W_FIELDS.includes(this.anaOperationCommand);
    },

    /**
     * @return {boolean} True if the operation field is set, required, and isn't valid field.
     */
    anaInvalidOperationField() {
      return (
        this.anaOperationField &&
        !this.anaDisabledOperationField &&
        !this.fields.some((f) => f.id === this.anaOperationField)
      );
    },

    /**
     * @return {string} Return the operation to group by.
     */
    anaOperation() {
      if (this.anaOperationCommand) {
        let parts = [this.anaOperationCommand];
        if (OPERATIONS_W_FIELDS.includes(this.anaOperationCommand)) {
          if (!this.anaOperationField || this.anaInvalidOperationField) {
            return false;
          }
          parts.push(this.anaOperationField);
        } else {
          parts.push('*');
        }

        return parts.join(':');
      }

      return false;
    }
  },

  watch: {
    /**
     * Try to keep query filters in sync with view for bookmarking.
     */
    viewMode(mode) {
      if (mode === VIEW_MODE.LIST) {
        window.history.replaceState(null, '', '?' + this.queryParams.toString());
      } else {
        window.history.replaceState(null, '', '?' + this.anaQueryParams.toString());
      }

      // TODO
      if (this.viewMode === VIEW_MODE.ANALYZE && this.validAnaParams) {
        this.analyze(this.anaQueryParams);
      }
    },

    currentFilters: {
      deep: true,
      handler: function () {
        this.baseParams.offset = 0;
        this.anaBaseParams.offset = 0;
        this.fetchFilters();
      }
    },

    showDeleted() {
      if (!this.isMounted) {
        return;
      }

      let params = new URLSearchParams(window.location.search);
      if (this.showDeleted) {
        params.set('deleted', '1');
      } else {
        params.delete('deleted');
      }
      window.location.search = params.toString();
    },

    anaQueryParams() {
      if (this.isAnalyzeMode && this.validAnaParams) {
        this.analyze(this.anaQueryParams);
      }
    },

    anaOperationCommand(value, previous) {
      if (this.anaDisabledOperationField) {
        this.anaOperationField = null;
      }
    },

    anaKeys() {
      this.anaBaseParams.offset = 0;
    },
    anaOperation() {
      this.anaBaseParams.offset = 0;
    }
  },

  mounted() {
    this.updatePaginationPlacement();
    document.querySelector('.dropdown.filters').addEventListener('shown.bs.dropdown', (event) => {
      this.$refs['filter-search'].select();
    });

    if (this.isAnalyzeMode && this.validAnaParams) {
      this.analyze(this.anaQueryParams);
    }

    window.addEventListener('resize', this.onResize);
    this.onResize();

    // Fix bad chrome bug with back button and the bootstrap switch styles.
    if (/(\?|\&)deleted=1/.test(window.location.search)) {
      setTimeout(() => {
        this.showDeleted = true;
        this.$nextTick(() => {
          this.isMounted = true;
        });
      }, 200);
    } else {
      this.isMounted = true;
    }
  },

  methods: {
    /**
     * On browser resize event. Also invoked when data changes to account for header height changes.
     */
    onResize() {
      if (this.$refs.header) {
        let headerRect = this.$refs.header.getBoundingClientRect();
        document.documentElement.style.setProperty(
          '--fixed-header-height',
          headerRect.height + 'px'
        );

        let dataRect = this.$refs.data.getBoundingClientRect();
        this.$refs.data.style.height = window.innerHeight - dataRect.top + 'px';
      }
    },

    /**
     * Get the filter name.
     * @param {string} filterId The filter ID.
     * @return  {string} The filter name or id.
     */
    fieldName(filterId) {
      let filter = this.fields.find((f) => f.id === filterId);
      if (filter) {
        return filter.name || filter.id;
      }
      return filterId;
    },

    /**
     * Add a filter and optionally focus on it's input.
     * @param {string} filterId
     * @param {boolean} andFocus
     */
    addFilter(filterId, andFocus = false) {
      this.currentFilters[filterId] = this.currentFilters[filterId] || [];
      if (andFocus) {
        this.$nextTick(() => {
          this.selectFilterInput(filterId);
        });
      }
    },

    /**
     * Add a filter value.
     * @param {string} filterId
     * @param {string} value
     */
    addFilterValue(filterId, value) {
      let v = value ? value.trim() : '';
      if (v) {
        this.addFilter(filterId);
        this.currentFilters[filterId].push(v);
        this.$nextTick(() => {
          this.selectFilterInput(filterId);
        });
      }
    },

    /**
     * Select a filter input. Optionally clear it.
     * @param {string} filterId
     * @param {boolean} clearInput
     */
    selectFilterInput(filterId, clearInput = true) {
      let key = `filterInput-${filterId}`;
      if (this.$refs[key]) {
        let ref = Array.isArray(this.$refs[key]) ? this.$refs[key][0] : this.$refs[key];
        if (ref) {
          if (clearInput) {
            ref.value = '';
          }
          ref.focus();
        }
      }
    },

    /**
     * Remove a filter value. If no index is provided, remove last value.
     * @param {string} filterId
     * @param {number} index
     */
    removeFilter(filterId, index) {
      let values = this.currentFilters[filterId];
      if (values) {
        if (typeof index === 'number') {
          values.splice(index, 1);
        } else if (values.length) {
          values.splice(values.length - 1, 1);
        }
      }

      this.$nextTick(() => {
        this.selectFilterInput(filterId, false);
      });
    },

    /**
     * Fetch and replace data with new filter.
     */
    fetchFilters() {
      let params = this.queryParams;
      const url = '?' + params.toString();
      $api(window.location.pathname + url + '&xhr=1')
        .then((text) => {
          if (url !== window.location.search) {
            window.history.replaceState(null, '', url);
          }
          let $data = document.getElementById('data');
          $data.innerHTML = text;
          this.updatePaginationPlacement();

          // TODO move this into vue
          updateExportLinks(getFormPrefs().hiddenFields);
          this.onResize();
        })
        .catch((error) => {
          this.error = error && error.message ? error.message : error;
        });
    },

    /**
     * Make sure our top pagination is correctly next to the toolbar.
     */
    updatePaginationPlacement() {
      let $top = this.$refs['top-pagination'];
      $top.innerHTML = '';

      let $nav = this.$refs.data.querySelector('.top-pagination');
      if ($nav) {
        $top.appendChild($nav);
        $nav.classList.remove('d-none');
      }
    },

    /**
     * Click events within the data list table. Things we can't easily do with native vue click.
     * @param {PointerEvent} event
     */
    onDataElClick(event) {
      let $addFilter = event.target.closest('.add-filter');
      if ($addFilter) {
        this.addFilter($addFilter.dataset.id, true);
      }
    },

    /**
     * Select the analyze fields search input.
     */
    anaSelectSearchFields() {
      this.$nextTick(() => {
        if (this.$refs.anaFieldSearch) {
          this.$refs.anaFieldSearch.select();
        }
      });
    },

    /**
     * Fetch the analyze data set.
     * @param {URLSearchParams} query
     */
    analyze(query) {
      this.anaError = null;
      let url = `/data-viewer/${this.ORIGIN_TYPE}/${this.ORIGIN_ID}/reduce?` + query.toString();
      $api(url)
        .then((text) => {
          window.history.replaceState(null, '', '?' + query.toString());
          let $data = this.$refs['analyze-results'];
          if ($data) {
            $data.innerHTML = text;
          }

          for (let p of BASE_QUERY_PARAMS) {
            if (query.has(p) && p !== 'offset') {
              this.anaBaseParams[p] = query.get(p);
            }
          }

          this.onResize();
          window.scrollTo({ top: 0, behavior: 'instant' });
        })
        .catch((error) => {
          this.anaError = error?.message ? error.message : error;
        });
    },

    /**
     * Remove the key from our analyze IDs.
     * @param {string} key
     */
    anaRemoveKey(key) {
      this.anaKeys = this.anaKeys.filter((k) => k !== key);
    },

    /**
     * Intercept analyze pagination, sort links and other clicks.
     * @param {PointerEvent} event
     */
    analyzeTableClick(event) {
      let $a = event.target.closest('a');
      if ($a) {
        // Only hijack non-special clicks.
        if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
          event.preventDefault();
          let query = $a.href.split('?');
          if (query.length > 1) {
            query = new URLSearchParams(query[1]);
            for (let p of BASE_QUERY_PARAMS) {
              if (query.has(p)) {
                this.anaBaseParams[p] = query.get(p);
              }
            }
          }
        }
        return;
      }

      let $addFilter = event.target.closest('.add-filter');
      if ($addFilter) {
        this.addFilter($addFilter.dataset.id, true);
      }
    },

    /**
     * Trigger the analyze key select dropdown.
     */
    triggerAnaKeysDropdown() {
      setTimeout(() => {
        this.$refs['ana-field-toggles'].click();
        this.anaSelectSearchFields();
      }, 0);
    }
  }
}).mount('body > main');

