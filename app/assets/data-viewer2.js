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
      language: window._LANGUAGE || null,
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
      anaFieldSearch: '',
      isNoteExpanded: true,
      showNoteToggle: false,
      checkedSubmissions: [],
      copyToModalTitle: '',
      isSavingNewSubmission: false,
      newSubmission: {},
      isCommitingImport: false,
      allowTracking: false,
      isTracking: false,
      filteringToTracked: false,
      tracked: []
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

      if (this.filteringToTracked) {
        params.set('__saved', true);
        params.delete('_id');
        let storedIds = this.tracked;
        for (let id of storedIds) {
          params.append('_id', id);
        }
      } else {
        if (this.showDeleted) {
          params.set('deleted', 1);
        }
        Object.keys(this.currentFilters).forEach((filter) => {
          this.currentFilters[filter].filter(Boolean).forEach((v) => {
            params.append(filter, v);
          });
        });
      }
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
        this.$nextTick(this.setupTrackedTooltip);
      } else {
        window.history.replaceState(null, '', '?' + this.anaQueryParams.toString());
      }

      if (this.viewMode === VIEW_MODE.ANALYZE && this.validAnaParams) {
        this.analyze(this.anaQueryParams);
      }
    },

    currentFilters: {
      deep: true,
      handler: function (filters, previousFilters) {
        let count = Object.values(filters).reduce((sum, arr) => {
          return sum + arr.length;
        }, 0);
        let prevCount = Object.values(previousFilters).reduce((sum, arr) => {
          return sum + arr.length;
        }, 0);

        if (count === prevCount) {
          // If we're not actually searching for something new, no need to do the query.
          return;
        }

        this.baseParams.offset = 0;
        this.anaBaseParams.offset = 0;

        // Avoid race condition when clearing filters to fetch tracked IDs.
        if (!this.preventFilterFetch) {
          this.fetchFilters();
        }
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
    let prefs = this.getFormPrefs();
    this.updatePaginationPlacement();
    document.querySelector('.dropdown.filters').addEventListener('shown.bs.dropdown', (event) => {
      this.$refs['filter-search'].select();
    });

    this.$refs.fieldTogglesBtn.addEventListener('shown.bs.dropdown', (event) => {
      this.onShowFieldToggles(event);
    });

    this.$refs.fieldTogglesBtn.addEventListener('hide.bs.dropdown', (event) => {
      this.onHideFieldToggles(event);
    });

    // Listen for submission details modal open.
    this.$refs.data.addEventListener('show.bs.modal', (event) => {
      if (event.target.matches('.modal.record-details')) {
        this.renderSubmissionDetailsModal(event.target);
      }
    });

    if (this.$refs.copyToModal) {
      this.copyToModal = new bootstrap.Modal(this.$refs.copyToModal);
    }

    if (this.isAnalyzeMode && this.validAnaParams) {
      this.analyze(this.anaQueryParams);
    }

    // #######################################################
    // # NEW SUBMISSION LOGIC
    // #######################################################
    let $createModal = document.getElementById('new-submission-modal');
    if ($createModal) {
      $createModal.addEventListener('shown.bs.modal', (event) => {
        let $firstInput = $createModal.querySelector('input.field-value');
        if ($firstInput) {
          $firstInput.focus();
        }
      });
    }

    // Fix bad chrome bug with back button and the bootstrap switch styles.
    let showDeleted = /(\?|\&)deleted=1/.test(window.location.search);
    if (showDeleted) {
      setTimeout(() => {
        this.showDeleted = true;
        this.$nextTick(() => {
          this.isMounted = true;
        });
      }, 200);
    } else {
      this.isMounted = true;
    }

    // Setup note toggle if source/view has a note.
    if (this.$refs.note) {
      this.showNoteToggle = this.$refs.note.querySelectorAll('br').length > 0;
      if (!this.showNoteToggle) {
        this.showNoteToggle = this.$refs.note.textContent.trim().length > 150;
      }

      if (prefs.isNoteHidden) {
        this.isNoteExpanded = false;
      }
    }

    if (prefs.hiddenFields) {
      this.updateExportLinks(prefs.hiddenFields);
    }

    window.addEventListener('message', this.onIframeMessage);
    window.addEventListener('resize', this.onResize);
    this.$nextTick(() => {
      // Add a tick so the note is the correct height before sizing.
      this.onResize();
    });

    if (this.$refs.tracking) {
      this.allowTracking = true;
      if (Array.isArray(this.getTracked())) {
        this.isTracking = true;
        this.restoreTracked();
      }
      this.setupTrackedTooltip();
    }
  },

  methods: {
    /**
     * On browser resize event. Also invoked when data changes to account for header height changes.
     */
    onResize() {
      if (this.$refs.header) {
        let headerRect = this.$refs.header.getBoundingClientRect();
        let headerHeight = headerRect.height;

        // If we have a lot of filters, don't make the header sticky.
        let fixedHeader = headerHeight < window.innerHeight / 2;
        if (fixedHeader) {
          this.$refs.header.classList.add('sticky-top');
          document.documentElement.style.setProperty('--fixed-header-height', headerHeight + 'px');
        } else {
          this.$refs.header.classList.remove('sticky-top');
          document.documentElement.style.setProperty('--fixed-header-height', 0 + 'px');
        }

        let dataRect = this.$refs.data.getBoundingClientRect();
        if (fixedHeader) {
          this.$refs.data.style.height = window.innerHeight - dataRect.top + 'px';
        } else {
          this.$refs.data.style.height = window.innerHeight + 'px';
        }
      }
    },

    /**
     * Put user focus back on the data table.
     * Focus on first row so keyboard works well with up/down.
     */
    focusOnDataTable() {
      this.$refs.data.querySelector('> table tbody tr').focus();
    },

    /**
     * React to messages sent from embedded iframes.
     * @param {MessageEvent} event
     */
    onIframeMessage(event) {
      if (event.origin !== window.location.origin || !event.data) {
        return;
      }

      // Iframe load events
      if (event.data?.action == 'load') {
        let link = `<a href="/data-viewer/${event.data.value.type}/${event.data.value.id}"
          target="_blank">
          ${event.data.value.name}
          <i class="bi bi-arrow-right-short align-middle"></i>
        </a>`;

        // Update the edit modal to show linked source and link
        document
          .getElementById('edit-modal')
          .querySelector('.modal-dialog .modal-title').innerHTML = 'Select from ' + link;

        // Update the lookup ref modal to show linked source and link
        document
          .getElementById('lookup-ref-modal')
          .querySelector('.modal-dialog .modal-title').innerHTML = link;
      } else if (event.data?.action === 'done-copy-to') {
        this.copyToModal.hide();
      } else if (event.data?.action === 'copy-to-updates') {
        if (event.data.updates) {
          event.data.updates.forEach((update) => {
            let $td = this.$refs.data.querySelector(
              `tr[data-id="${update.id}"] > td[data-field="${update.field}"]`
            );
            if ($td) {
              $td.classList.add('editable', 'updated');
              $td.dataset.value = update.value !== null ? update.value : '';
              $td.innerHTML = update.html;
            }
          });
        }
      } else if (event.data?.action === 'copy-to-duplicates') {
        // On duplicate records, fetch the current page of data, and try to highlight
        // the new rows if they are on this page of data.
        this.fetchFilters().then(() => {
          event.data?.created.forEach((s) => {
            this.$refs.data.querySelectorAll(`tr[data-id="${s._id}"] > td`).forEach(($td) => {
              $td.classList.add('updated');
            });
          });
        });
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
        return filter.name;
      }
      return filterId;
    },

    /**
     * Add a filter and optionally focus on it's input.
     * @param {string} filterId
     * @param {boolean} andFocus
     */
    addFilter(filterId, andFocus = false) {
      // Poor man's deep clone and re-assignment
      // to make sure Vue gets distinct current vs previous in currentFilters deep watch handler.
      let filters = JSON.parse(JSON.stringify(this.currentFilters));
      filters[filterId] = filters[filterId] || [];
      this.currentFilters = filters;

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

        // Poor man's deep clone and re-assignment
        // to make sure Vue gets distinct current vs previous in currentFilters deep watch handler.
        let filters = JSON.parse(JSON.stringify(this.currentFilters));
        filters[filterId].push(v);
        this.currentFilters = filters;
        this.$nextTick(() => {
          this.selectFilterInput(filterId);
        });
      }
    },

    /**
     * Add filter values via paste for comma, tab, or new-line seperated values.
     * @param {string} filterId
     * @param {ClipboardEvent} event
     */
    pasteFilterValue(filterId, event) {
      let paste = (event.clipboardData || window.clipboardData).getData('text');

      if (paste) {
        let del = ',';
        if (paste.includes('\t')) {
          del = '\t';
        } else if (paste.includes('\n')) {
          del = '\n';
        }

        let values = paste
          .split(del)
          .map((v) => v?.trim())
          .filter(Boolean);

        if (values.length > 1) {
          event.preventDefault();
          values.forEach((v) => {
            this.addFilterValue(filterId, v);
          });
          this.$nextTick(() => {
            this.selectFilterInput(filterId);
          });
        }
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
      // Poor man's deep clone and re-assignment
      // to make sure Vue gets distinct current vs previous in currentFilters deep watch handler.
      let filters = JSON.parse(JSON.stringify(this.currentFilters));

      let values = filters[filterId];
      if (values) {
        if (typeof index === 'number') {
          values.splice(index, 1);
        } else if (values.length) {
          values.splice(values.length - 1, 1);
        }
      }
      this.currentFilters = filters;

      this.$nextTick(() => {
        this.selectFilterInput(filterId, false);
      });
    },

    /**
     * Fetch and replace data with new filter.
     * @return {Promise}
     */
    fetchFilters() {
      this.filteringToTracked = false;
      this.fetchPage(this.queryParams);
    },

    /**
     * Fetch data for this view and update the data table.
     * @param {URLSearchParams} origParams The params to query.
     * @param {boolean} preventScroll Pass true to prevent scrolling the data table to the top.
     * @return {Promise}
     */
    fetchPage(origParams, preventScroll = false) {
      let params = new URLSearchParams(origParams);
      let fetchOptions = {};
      this.error = null;

      // Do a POST when filtering tracked to avoid super long URLs
      if (this.filteringToTracked) {
        fetchOptions.method = 'POST';
        let body = { _id: params.getAll('_id') };
        params.delete('_id');
        fetchOptions.body = JSON.stringify(body);
      }

      let url = '?' + params.toString();
      return $api(window.location.pathname + url + '&xhr=1', fetchOptions)
        .then((text) => {
          if (url !== window.location.search) {
            if (this.filteringToTracked) {
              params.delete('__saved');
            }
            window.history.replaceState(null, '', '?' + params.toString());
          }
          this.$refs.data.innerHTML = text;
          this.updatePaginationPlacement();

          this.updateExportLinks(this.getFormPrefs().hiddenFields);
          this.restoreTracked();
          this.onResize();

          if (!preventScroll) {
            this.$refs.data.scrollTo({ top: 0, behavior: 'instant' });
          }

          if (this.filteringToTracked) {
            let rowsReturned = this.$refs.data.querySelectorAll(
              'table > tbody > tr:not(.no-results)'
            ).length;
            if (this.tracked.length !== rowsReturned) {
              throw new Error(`Requested ${this.tracked.length.toLocaleString()}, but only
                ${rowsReturned.toLocaleString()} returned. Records may have been archived.`);
            }
          }
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
      // Only hijack non-special clicks.
      const specialClick = event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;

      let $addFilter = event.target.closest('.add-filter');
      if ($addFilter) {
        this.addFilter($addFilter.dataset.id, true);
        return;
      }

      // Check all event handler
      let $checkAll = document.getElementById('check-all');
      if ($checkAll && (event.target === $checkAll || event.target.matches('th.checkbox'))) {
        if (event.target.matches('th.checkbox')) {
          $checkAll.checked = !$checkAll.checked;
          $checkAll.indeterminate = false;
        }

        let checked = $checkAll.checked;
        let indeterminate = $checkAll.indeterminate;
        let checkAll = checked && !indeterminate;

        let $checks = this.$refs.data.querySelectorAll('.submission-check');
        $checks.forEach((el) => {
          el.checked = checkAll;
        });
        this.onCheckedChange();
        return;
      }

      // Row check event handler
      if (event.target.closest('.submission-check')) {
        this.onCheckedChange();
        return;
      }

      // Checkbox TD helper.
      if (event.target.classList.contains('for-submission-check')) {
        let $checkbox = event.target.querySelector('.submission-check');
        $checkbox.checked = !$checkbox.checked;
        this.onCheckedChange();
        return;
      }

      // Sort or paginate link click
      let $a = event.target.closest('a.fetch');
      if ($a && !specialClick) {
        event.preventDefault();
        let href = $a.getAttribute('href').split('?').pop();
        let linkParams = new URLSearchParams(href);
        let params = new URLSearchParams(this.queryParams);

        // If we are simply increasing the page size, prevent data table scroll reset.
        let moreResults =
          $a.classList.contains('page-size-change') &&
          parseInt(linkParams.get('limit')) > parseInt(this.queryParams.get('limit'));

        for (let key of linkParams.keys()) {
          for (let value of linkParams.getAll(key)) {
            params.set(key, value);
          }
        }

        for (let p of BASE_QUERY_PARAMS) {
          if (linkParams.has(p)) {
            this.baseParams[p] = linkParams.get(p);
            this.anaBaseParams[p] = linkParams.get(p);
          }
        }

        this.fetchPage(params, moreResults);

        return;
      }

      let $exportBtn = event.target.closest('.export-btn');
      if ($exportBtn) {
        if (this.filteringToTracked) {
          event.preventDefault();
          let query = $exportBtn.getAttribute('href').split('?').pop();
          let params = new URLSearchParams(query);
          this.exportTracked(params);
        }
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
    },

    /**
     * Show or hide the note.
     */
    toggleNote() {
      this.isNoteExpanded = !this.isNoteExpanded;
      this.$nextTick(this.onResize);
      this.setFormPref('isNoteHidden', !this.isNoteExpanded);
    },

    /**
     * Show field toggles dropdown event.
     */
    onShowFieldToggles() {
      this.$refs.fieldTogglesSearch.select();
    },

    /**
     * Hide field toggles dropdown event.
     */
    onHideFieldToggles() {
      let hidden = Array.from(
        this.$refs.fieldTogglesList.querySelectorAll('input[type=checkbox]:not(:checked)')
      )
        .map((el) => {
          return el.value;
        })
        .sort();

      this.hideFields(hidden);
      this.$refs.fieldTogglesBtn.querySelector('.visible-count').innerText =
        this.fields.length - hidden.length;
      this.updateExportLinks(hidden);

      // If we're resetting the fields back to their defaults, clear saved preference.
      let defaultHiddenFields = this.fields
        .filter((f) => !f.default)
        .map((f) => f.id)
        .sort();

      if (defaultHiddenFields.length === hidden.length) {
        if (hidden.every((id) => defaultHiddenFields.includes(id))) {
          hidden = null;
        }
      }

      this.setFormPref('hiddenFields', hidden);
    },

    /**
     * On filter input for field toggles.
     * @param {KeyboardEvent} event
     */
    onFieldTogglesSearch(event) {
      let query = event.target.value.toLowerCase();
      this.$refs.fieldTogglesList.querySelectorAll('.toggle').forEach((el) => {
        if (
          !query ||
          el.dataset.name.toLowerCase().indexOf(query) >= 0 ||
          el.dataset.id.toLowerCase().indexOf(query) >= 0
        ) {
          el.classList.remove('d-none');
        } else {
          el.classList.add('d-none');
        }
      });
    },

    /**
     * Select "All" button on the field toggles.
     */
    onFieldTogglesAll() {
      this.$refs.fieldTogglesList
        .querySelectorAll('.toggle:not(.d-none) input[type=checkbox]')
        .forEach((el) => {
          el.checked = true;
        });
    },

    /**
     * Select "None" button on the field toggles.
     */
    onFieldTogglesNone() {
      this.$refs.fieldTogglesList
        .querySelectorAll('.toggle:not(.d-none) input[type=checkbox]')
        .forEach((el) => {
          el.checked = false;
        });
    },

    /**
     * Hide given fields
     * @param {Array} hiddenFields The hidden fields
     */
    hideFields(hiddenFields) {
      const head = document.getElementsByTagName('head')[0];
      let styleTag = document.getElementById('field-visibility-styles');
      if (styleTag) {
        styleTag.parentNode.removeChild(styleTag);
      }

      if (hiddenFields && hiddenFields.length) {
        let css = hiddenFields.reduce((str, field) => {
          return (
            str +
            `
            #data > table [data-field="${field}"] {
              display: none;
            }
            #data > table [data-field^="${field}["] {
              display: none;
            }`
          );
        }, '');

        styleTag = document.createElement('style');
        styleTag.id = 'field-visibility-styles';
        styleTag.textContent = css;
        head.append(styleTag);
      }
    },

    /**
     * Reset field visibility to source defaults.
     */
    resetFields() {
      let visibleFields = this.fields.filter((f) => f.default).map((f) => f.id);
      this.$refs.fieldTogglesList.querySelectorAll('input[type=checkbox]').forEach((el) => {
        el.checked = visibleFields.includes(el.value);
      });
    },

    /**
     * Update the export links to take into account hidden fields.
     * @param {Array} hidden The list of hidden field IDs
     */
    updateExportLinks(hidden) {
      document.querySelectorAll('.export-btn:not(.all)').forEach(($a) => {
        let href = $a.href.replace(/&_h=[^&]+/i, '');
        if (hidden && hidden.length) {
          $a.href = href + '&_h=' + encodeURIComponent(hidden.join(','));
        } else {
          $a.href = href;
        }
      });
    },

    /**
     * Get source/view preferences
     * @return {object}
     */
    getFormPrefs() {
      return window._prefs || {};
    },

    /**
     * Set a preference for this source/view.
     * @param {string} field
     * @param {*} value
     * @returns
     */
    setFormPref(field, value) {
      let prefs = this.getFormPrefs();
      prefs[field] = value;

      if (this.ORIGIN_TYPE === 'import') {
        // imports don't have a type so ignore.
        return;
      }

      return $api(`/api/user/pref/${this.ORIGIN_TYPE}/${this.ORIGIN_ID}`, {
        method: 'POST',
        body: JSON.stringify(prefs)
      }).catch((error) => {
        alert(error && error.message ? error.message : error);
      });
    },

    /**
     * Handle submission selection checkbox logic.
     */
    onCheckedChange() {
      let $checkAll = document.getElementById('check-all');
      let $data = this.$refs.data;
      let checkedIds = [];
      let uncheckedIds = [];

      [...$data.querySelectorAll('.submission-check')].forEach(($check) => {
        if ($check.checked) {
          checkedIds.push($check.dataset.id);
        } else {
          uncheckedIds.push($check.dataset.id);
        }
      });
      this.checkedSubmissions = checkedIds;

      this.setTracked(checkedIds, uncheckedIds);

      if ($checkAll && $checkAll.checked) {
        let total = $data.querySelectorAll('.submission-check').length;
        $checkAll.indeterminate = total !== this.checkedSubmissions.length;
      }
    },

    /**
     * Copy To or Duplicate button handler. Will show the correct modal.
     * @param {bolean} isDuplicate True if this is a duplication.
     */
    onCopyToBtn(isDuplicate = false) {
      if (!this.checkedSubmissions.length) {
        return;
      }

      this.copyToModalTitle = `${isDuplicate ? 'Duplicate' : 'Copy'} ${
        this.checkedSubmissions.length
      } ${this.checkedSubmissions.length > 1 ? 'submissions' : 'submission'}`;

      let $iframe = document.createElement('iframe');
      $iframe.classList.add('copy-to');
      $iframe.setAttribute('name', 'copy-to-frame');
      let params = new URLSearchParams();
      if (isDuplicate) {
        params.set('destId', this.ORIGIN_ID);
      }

      this.$refs.copyToModal.querySelector('.modal-body').replaceChildren($iframe);

      // To avoid super long URLs for copying many entries, do a form POST of
      // our list of submissions and direct the POST reponse to the iframe we created above.
      let $copyForm = document.createElement('form');
      $copyForm.style.display = 'none';
      $copyForm.setAttribute('target', 'copy-to-frame');
      $copyForm.setAttribute('method', 'POST');
      $copyForm.setAttribute(
        'action',
        `/data-viewer/${this.ORIGIN_TYPE}/${this.ORIGIN_ID}/copy-to?${params.toString()}`
      );
      this.checkedSubmissions.forEach((id) => {
        let $input = document.createElement('input');
        $input.setAttribute('type', 'hidden');
        $input.setAttribute('name', 'id');
        $input.setAttribute('value', id);
        $copyForm.appendChild($input);
      });
      document.body.appendChild($copyForm);
      $copyForm.submit();
      document.body.removeChild($copyForm);

      this.copyToModal.show();
    },

    /**
     * Delete or archive button handler.
     * @param {boolean} isRestore True if this is a restore.
     */
    onArchiveBtn(isRestore = false) {
      const count = this.checkedSubmissions.length;
      const isSource = this.ORIGIN_TYPE === 'source';
      const isImport = this.ORIGIN_TYPE === 'import';

      if (!isSource && !isImport) {
        return;
      }

      if (!count) {
        return;
      }

      let operation = isRestore ? 'restore' : 'delete';
      let label = isRestore ? 'restore' : isImport ? 'delete' : 'archive';
      let noun = count > 1 ? 'submissions' : 'submission';
      let prompt = `Are you sure you want to ${label} ${count} ${noun}?`;

      if (confirm(prompt)) {
        let url = `/api/${this.ORIGIN_TYPE}/${this.ORIGIN_ID}/submissions/${operation}`;
        if (this.ORIGIN_TYPE === 'import') {
          url = `/api/source/${this.ORIGIN_ID}/import/submissions/${operation}`;
        }

        $api(url, {
          method: 'POST',
          body: JSON.stringify(this.checkedSubmissions)
        })
          .then(() => {
            if (this.isTracking) {
              this.setTracked([], this.checkedSubmissions);
            }
            window.location.reload();
          })
          .catch((error) => {
            alert(error && error.message ? error.message : error);
          });
      }
    },

    /**
     * Create a new submission from the modal data.
     */
    onNewSubmission() {
      if (this.isSavingNewSubmission) {
        return;
      }

      this.isSavingNewSubmission = true;
      const submission = Object.keys(this.newSubmission).reduce((s, fieldId) => {
        let value = this.newSubmission[fieldId]?.trim();
        if (value) {
          s[fieldId] = value;
        }
        return s;
      }, {});

      $api(`/api/source/${this.ORIGIN_ID}/submission`, {
        method: 'POST',
        body: JSON.stringify(submission)
      })
        .then(() => {
          window.location.reload();
        })
        .catch((error) => {
          alert(error && error.message ? error.message : error);
        })
        .finally(() => {
          this.isSavingNewSubmission = false;
        });
    },

    /**
     * Fetch submission and render details modal tabs.
     * @param {Element} domTarget The submission details modal.
     */
    renderSubmissionDetailsModal(domTarget) {
      domTarget.classList.add('loading');
      let url = null;
      if (this.ORIGIN_TYPE == 'import') {
        let [match, sourceId, importId] = /\/source\/([^\/]+)\/import\/([^\/]+)/i.exec(
          window.location.pathname
        );
        url = `/api/source/${sourceId}/submission/${domTarget.dataset.id}?staged=true`;
      } else {
        url = `/api/${this.ORIGIN_TYPE}/${this.ORIGIN_ID}/submission/${domTarget.dataset.id}`;
      }

      return $api(url, {
        method: 'GET'
      })
        .then((response) => {
          let record = null;
          if (this.ORIGIN_TYPE === 'view') {
            if (response.results?.length) {
              let index = parseInt(domTarget.dataset.index);
              record = response.results[isNaN(index) ? 0 : index];
            }
          } else {
            record = response;
          }
          domTarget.querySelector('.source-json').innerText = JSON.stringify(
            record.data,
            undefined,
            2
          );

          let events = record._edits || [];

          // TODO revisit this for showing view data history
          events = events.filter((e) => {
            return !e.viewData;
          });

          let history = '';
          for (let i = events.length - 1; i >= 0; i--) {
            let event = events[i];
            let modified = event.modified;
            let modifiedLocal = new Date(event.modified);
            let time = `
              <time
              datetime="${modified}"
              title="${modified} UTC"
            >
              ${modifiedLocal.toLocaleDateString()} ${modifiedLocal.toLocaleTimeString()}
            </time>
          `;
            let user = `<div class="ms-2 user">${event.modifiedBy.name}</div>`;

            let detailsHtml = '';
            if (typeof event.deleted === 'boolean') {
              if (event.deleted) {
                detailsHtml = '<span class="text-danger">Archived</span>';
              } else {
                detailsHtml = '<span class="text-success">Retored</span>';
              }
            } else {
              let update = event.update;
              if (!update) {
                update = {};
                update[event.field] = event.value;
              }
              detailsHtml =
                '<pre class="update w-50 m-0 text-success">' +
                JSON.stringify(update, undefined, 2) +
                '</pre>';

              if (event.previous) {
                detailsHtml +=
                  '<pre class="previous w-50 m-0 text-danger">' +
                  JSON.stringify(event.previous, undefined, 2) +
                  '</pre>';
              }
            }

            let clazz = i % 2 === 0 ? 'bg-body-secondary' : '';
            let str = `<div class="p-2 d-flex flex-wrap ${clazz}">
              ${time}
              ${user}
              <div class="diff w-100 d-flex justify-content-between">
                ${detailsHtml}
              </div>
              </div>`;

            history += str;
          }
          domTarget.querySelector('.tab-pane.history').innerHTML = history;
        })
        .catch((error) => {
          domTarget.querySelector('.tab-pane .source-json').innerText = error.message
            ? error.message
            : error;
        })
        .finally(() => {
          domTarget.classList.remove('loading');
        });
    },

    /**
     * Commit the staged import after confirmation.
     */
    commitImport() {
      if (confirm('Are you sure you want to import all records?')) {
        this.isCommitingImport = true;
        let [match, sourceId, importId] = /\/source\/([^\/]+)\/import\/([^\/]+)/i.exec(
          window.location.pathname
        );
        $api(`/api/source/${sourceId}/import/${importId}`, {
          method: 'POST'
        })
          .then(() => {
            window.location.href = `/data-viewer/source/${sourceId}/import`;
          })
          .catch((error) => {
            this.isCommitingImport = false;
            alert(error && error.message ? error.message : error);
          });
      }
    },

    /**
     * Discard the staged import after confirmation.
     */
    discardImport() {
      if (confirm('Are you sure you want to delete this staged import?')) {
        this.isCommitingImport = true;
        let [match, sourceId, importId] = /\/source\/([^\/]+)\/import\/([^\/]+)/i.exec(
          window.location.pathname
        );
        $api(`/api/source/${sourceId}/import/${importId}`, {
          method: 'DELETE'
        })
          .then(() => {
            window.location.href = `/data-viewer/source/${sourceId}/import`;
          })
          .catch((error) => {
            alert(error && error.message ? error.message : error);
            this.isCommitingImport = true;
          });
      }
    },

    /**
     * Enable tracking of records.
     */
    enableTracking() {
      this.isTracking = true;
      this.onCheckedChange();
      if (this.trackingTooltip) {
        this.trackingTooltip.dispose();
      }
    },

    /**
     * Disable and clear tracking of records.
     */
    disableTracking() {
      this.isTracking = false;
      this.filteringToTracked = false;
      this.resetTracked();
      this.$nextTick(this.setupTrackedTooltip);
    },

    /**
     * Restore which records are being tracked by checking them.
     */
    restoreTracked() {
      if (this.isTracking) {
        let tracked = this.getTracked() || [];

        // TODO what about exploded views with duplicate IDS
        let $checkboxes = this.$refs.data.querySelectorAll(`.for-submission-check > input`);
        for (let $checkbox of $checkboxes) {
          $checkbox.checked = tracked.includes($checkbox.dataset.id);
        }

        let $checkAll = document.getElementById('check-all');
        if ($checkAll) {
          $checkAll.checked = false;
          $checkAll.indeterminate = false;
        }

        this.onCheckedChange();
      }
    },

    /**
     * Get tracked record IDs. Return false if not tracking.
     * @return {Array|boolean}
     */
    getTracked() {
      try {
        let ttl = window.localStorage.getItem(`track-ttl-${this.ORIGIN_ID}`);
        if (ttl) {
          let future = new Date();
          let now = new Date();
          future.setTime(ttl);
          if (now < future) {
            let json = window.localStorage.getItem(`track-data-${this.ORIGIN_ID}`);
            if (json) {
              let storedIds = JSON.parse(json);
              if (Array.isArray(storedIds)) {
                return storedIds;
              }
            }
          }
        }
      } catch (error) {
        console.error(error);
      }

      return false;
    },

    /**
     * Mark records as tracked or untracked.
     * @param {Array} checkedIds IDs to add to tracking.
     * @param {Array} uncheckedIds IDs to remove from tracking.
     */
    setTracked(checkedIds = [], uncheckedIds = []) {
      if (this.isTracking) {
        let storedIds = this.getTracked() || [];

        for (let id of checkedIds) {
          if (!storedIds.includes(id)) {
            storedIds.push(id);
          }
        }

        for (let id of uncheckedIds) {
          let index = storedIds.indexOf(id);
          if (index !== -1) {
            storedIds.splice(index, 1);
          }
        }

        try {
          // Allow tracking to persist for 7 days
          window.localStorage.setItem(
            `track-ttl-${this.ORIGIN_ID}`,
            new Date().getTime() + 1000 * 60 * 60 * 24 * 7
          );
          window.localStorage.setItem(`track-data-${this.ORIGIN_ID}`, JSON.stringify(storedIds));
        } catch (error) {
          console.error(error);
        }

        this.tracked = storedIds;
      }
    },

    /**
     * Clear what is being tracked.
     */
    resetTracked() {
      try {
        window.localStorage.removeItem(`track-ttl-${this.ORIGIN_ID}`);
        window.localStorage.removeItem(`track-data-${this.ORIGIN_ID}`);
        this.tracked = [];
        this.baseParams.offset = 0;
        this.fetchPage(this.queryParams);
      } catch (error) {
        console.error(error);
      }
    },

    /**
     * Filter to just the tracked records.
     */
    showTracked() {
      if (this.isTracking) {
        this.filteringToTracked = true;

        // Avoid race condition of clearing active filters, fetching a page while
        // we're trying to fetch tracked.
        this.preventFilterFetch = true;
        this.currentFilters = {};
        this.baseParams.offset = 0;
        this.fetchPage(this.queryParams);

        // Reset filters once page state is set.
        this.$nextTick(() => {
          this.preventFilterFetch = false;
        });
      }
    },

    /**
     * Unfilter and show all records.
     */
    unshowTracked() {
      if (this.isTracking) {
        this.filteringToTracked = false;
        this.currentFilters = {};
        this.fetchPage(this.queryParams);
      }
    },

    /**
     * Export the tracked records with the provided config. Allows a form POST rather
     * than a super long URL of IDs.
     * @param {URLSearchParams} params The export params
     */
    exportTracked(params) {
      let $form = document.createElement('form');
      $form.style.display = 'none';
      $form.setAttribute('method', 'POST');
      $form.setAttribute(
        'action',
        `/data-viewer/csv/${this.ORIGIN_TYPE}/${this.ORIGIN_ID}?${params.toString()}`
      );
      for (let id of this.tracked) {
        let $input = document.createElement('input');
        $input.setAttribute('type', 'hidden');
        $input.setAttribute('name', '_id');
        $input.setAttribute('value', id);
        $form.appendChild($input);
      }
      document.body.appendChild($form);
      $form.submit();
      document.body.removeChild($form);
    },

    /**
     * Setup tooltip for tracking button.
     */
    setupTrackedTooltip() {
      let $btn = this.$refs['tracking-button'];
      if ($btn) {
        this.trackingTooltip = bootstrap.Popover.getOrCreateInstance($btn);
      }
    }
  }
}).mount('body > main');

