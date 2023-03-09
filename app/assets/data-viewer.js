const SYSTEM_PARAMS = ['table', 'sort', 'order', 'offset', 'limit'];

const $data = document.getElementById('data');
const ORIGIN_TYPE = $data.dataset.type;
const ORIGIN_ID = $data.dataset.id;

const updateSubmission = function (target, field, value, currentValue, valueType) {
  const formData = new FormData();

  if (target.fields && target.fields.length) {
    formData.append('fields', JSON.stringify(target.fields));
  } else if (target.ids && target.ids.length) {
    formData.append('ids', target.ids);
    formData.append('field', field);
  } else if (target.filter) {
    formData.append('filter', target.filter);
    formData.append('field', field);
  }

  formData.append('currentValue', currentValue);
  formData.append('value', value);
  formData.append('valueType', valueType);

  formData.append('originType', ORIGIN_TYPE);
  formData.append('originId', ORIGIN_ID);

  let url = `/data-viewer/api/edit/${ORIGIN_TYPE}`;
  let isAttachment = false;
  if (ORIGIN_TYPE === 'source' && value instanceof File) {
    isAttachment = true;
    url = '/data-viewer/api/edit/attachment';
  }

  return $api(url, {
    method: 'POST',
    body: formData
  }).then((response) => {
    if (target.ids) {
      let trs = [...$data.querySelectorAll('table tr')].filter(($tr) =>
        target.ids.includes($tr.dataset.id)
      );

      trs.forEach(($tr) => {
        let $td = $tr.querySelector(`td[data-field="${field}"]`);
        if ($td) {
          if (isAttachment) {
            $td.classList.remove('editable');
          } else {
            $td.classList.add('editable');
          }
          $td.dataset.value = response.value !== null ? response.value : '';
          $td.innerHTML = response.html;
        }

        $tr.querySelector('.record-source').classList.add('loading');
      });
    } else if (target.fields) {
      target.fields.forEach((f) => {
        let tds = $data.querySelectorAll(`tr[data-id="${f.id}"] > td[data-field="${f.field}"]`);
        tds.forEach(($td) => {
          $td.classList.add('editable');
          $td.dataset.value = response.value !== null ? response.value : '';
          $td.innerHTML = response.html;
          $td.closest('tr').querySelector('.record-source').classList.add('loading');
        });
      });
    }

    return response;
  });
};

// #######################################################
// # EDITING & UNDO STACK
// #######################################################

const undoStack = [];
const $undo = document.getElementById('undo');
if ($undo) {
  $undo.querySelector('button').addEventListener('click', () => {
    if (!undoStack.length) {
      return;
    }
    let toUndo = undoStack.pop();
    $undo.querySelector('button').setAttribute('disabled', 'disabled');
    updateSubmission(toUndo.target, toUndo.field, toUndo.value, toUndo.currentValue, toUndo.type)
      .catch((error) => {
        alert(error && error.message ? error.message : error);
      })
      .finally(() => {
        if (undoStack.length) {
          $undo.querySelector('button').removeAttribute('disabled', 'disabled');
        }
      });
  });
}

const pushUndo = function (item) {
  undoStack.push(item);
  if ($undo) {
    $undo.querySelector('button').removeAttribute('disabled');
  }
};

const saveEdit = function () {
  let input = editModal.$input;
  let inputType = editModal.$el.querySelector('select').value;
  editModal.$save.setAttribute('disabled', 'disabled');

  let newValue = input.value.trim();
  let error = null;

  if (inputType === 'attachment') {
    if (editModal.$attachment.files.length === 1) {
      newValue = editModal.$attachment.files[0];
    } else {
      error = 'File required';
    }
  } else if (inputType === 'int') {
    if (!newValue) {
      newValue = 0;
    }

    newValue = parseInt(newValue);
    if (isNaN(newValue)) {
      error = 'Invalid number';
    }
  } else if (inputType === 'float') {
    if (!newValue) {
      newValue = 0;
    }
    newValue = parseFloat(newValue);
    if (isNaN(newValue)) {
      error = 'Invalid number';
    }
  }

  if (error) {
    editModal.$save.removeAttribute('disabled');
    if (inputType !== 'attachment') {
      input.select();
    }
    alert(error);
    return;
  }

  editModal.$save.previousElementSibling.classList.remove('d-none');
  editModal.$el.querySelector('.btn-close').setAttribute('disabled', 'disabled');

  updateSubmission(
    editModal.editing.target,
    editModal.editing.field,
    newValue,
    editModal.editing.value,
    inputType
  )
    .then((response) => {
      if (inputType !== 'attachment') {
        pushUndo({ ...editModal.editing, currentValue: newValue });
      }

      if (editModal.onClose) {
        // Trigger modal on close, indicating a save ocurred.
        editModal.onClose(true);
        // Prevent double call of onClose
        editModal.onClose = null;
      }

      editModal.modal.hide();
    })
    .catch((error) => {
      console.error(error);
      alert(error && error.message ? error.message : error);
      if (inputType !== 'attachment') {
        input.select();
      }
    })
    .finally(() => {
      editModal.$save.removeAttribute('disabled');
      editModal.$save.previousElementSibling.classList.add('d-none');
    });
};

let el = document.getElementById('edit-modal');
const editModal = {
  $el: el,
  $input: document.getElementById('edit-input'),
  $attachment: document.getElementById('attachment-input'),
  $bulkWarning: document.getElementById('edit-count-warning'),
  $type: el.querySelector('select'),
  $save: el.querySelector('.btn-primary'),
  getEditTarget: (td) => {
    let target = {};

    // Views need to update individual fields on unique submissions
    if (ORIGIN_TYPE === 'view' && td) {
      let tdIndex = [...td.parentNode.children].indexOf(td);
      let fields = {};
      $data.querySelectorAll('.submission-check:checked').forEach(($check) => {
        let id = $check.dataset.id;
        let field = $check.closest('tr').children[tdIndex].dataset.field;
        fields[`${id}${field}`] = { id, field };
      });
      target.fields = Object.values(fields);
    } else {
      // Sources can edit a lot of stuff in bulk
      let ids = [];
      $data.querySelectorAll('.submission-check:checked').forEach((el) => {
        ids.push(el.dataset.id);
      });

      if (ids.length) {
        target.ids = ids;
      }
    }

    return target;
  }
};

editModal.modal = new bootstrap.Modal(editModal.$el);
editModal.$el.addEventListener('shown.bs.modal', (event) => {
  editModal.$input.select();
});
editModal.$el.addEventListener('hide.bs.modal', (event) => {
  editModal.$el.querySelector('.btn-close').removeAttribute('disabled');
  if (editModal.onClose) {
    editModal.onClose();
  }
});
editModal.$save.addEventListener('click', saveEdit);
editModal.$input.addEventListener('keyup', (event) => {
  if (event.key === 'Enter') {
    saveEdit();
  }
});
editModal.$type.addEventListener('change', (event) => {
  if (event.target.value === 'attachment') {
    editModal.$attachment.classList.remove('d-none');
    editModal.$input.classList.add('d-none');
  } else {
    editModal.$attachment.classList.add('d-none');
    editModal.$input.classList.remove('d-none');
    editModal.$input.select();
  }
});

$data.addEventListener('dblclick', function (event) {
  let td = event.target.closest('td.editable');
  if (td) {
    let curValue = td.dataset.value;

    // Ensure current row is checked
    let wasChecked = false;
    let $checkbox = td.closest('tr').querySelector('.submission-check');
    if (!$checkbox.checked) {
      $checkbox.checked = true;
      wasChecked = true;
    }

    let target = editModal.getEditTarget(td);
    let checkedCount = $data.querySelectorAll('.submission-check:checked').length;

    editModal.onClose = (saved = false) => {
      // On save, only one, clear
      // On cancel, only one, clear
      // On cancel, multiple, clear target if it wasn't originally checked
      if (checkedCount === 1) {
        $checkbox.checked = false;
      } else if (!saved && wasChecked) {
        $checkbox.checked = false;
      }
    };

    editModal.editing = {
      target: target,
      field: td.dataset.field,
      value: curValue
    };

    editModal.$attachment.classList.add('d-none');
    editModal.$attachment.value = '';
    editModal.$input.classList.remove('d-none');
    editModal.$input.value = curValue || '';

    let type = 'text';
    // Is number?
    if (curValue && /^[\d\.]+$/.test(curValue)) {
      type = 'int';
      if (curValue.indexOf('.') > -1) {
        type = 'float';
      }
    }

    editModal.editing.type = type;

    let inputType = editModal.$el.querySelector('select');
    inputType.value = type;

    if (checkedCount > 1) {
      const numberFormatter = new Intl.NumberFormat();
      editModal.$bulkWarning.querySelector('span').innerText = numberFormatter.format(checkedCount);
      editModal.$bulkWarning.classList.remove('d-none');
    } else {
      editModal.$bulkWarning.classList.add('d-none');
    }

    editModal.modal.show();
  }
});

// #######################################################
// # CHECKBOX LOGIC
// #######################################################

$data.addEventListener('click', (event) => {
  let $checkAll = document.getElementById('check-all');

  // Check all event handler
  if ($checkAll && (event.target === $checkAll || event.target.matches('th.checkbox'))) {
    if (event.target.matches('th.checkbox')) {
      $checkAll.checked = !$checkAll.checked;
      $checkAll.indeterminate = false;
    }

    let checked = $checkAll.checked;
    let indeterminate = $checkAll.indeterminate;
    let checkAll = checked && !indeterminate;

    $data.querySelectorAll('.submission-check').forEach((el) => {
      el.checked = checkAll;
    });

    return;
  }

  // Row check event handler
  let $checkbox = event.target.closest('.submission-check');
  if ($checkbox && $checkAll && $checkAll.checked) {
    let total = $data.querySelectorAll('.submission-check').length;
    let totalChecked = $data.querySelectorAll('.submission-check:checked').length;
    $checkAll.indeterminate = total !== totalChecked;
    return;
  }

  // Checkbox TD helper.
  if (event.target.classList.contains('for-submission-check')) {
    let $checkbox = event.target.querySelector('.submission-check');
    $checkbox.checked = !$checkbox.checked;
    if ($checkAll && $checkAll.checked) {
      let total = $data.querySelectorAll('.submission-check').length;
      let totalChecked = $data.querySelectorAll('.submission-check:checked').length;
      $checkAll.indeterminate = total !== totalChecked;
    }
    return;
  }
});

// #######################################################
// # VIEW ONLY LOGIC
// #######################################################

// Views can have multi-column edit effect
if (ORIGIN_TYPE === 'view') {
  $data.addEventListener('mouseover', function (event) {
    $data.querySelectorAll('.multi-active').forEach((el) => {
      el.classList.remove('multi-active');
    });
    let td = event.target.closest('td.editable');
    if (td && td.dataset.sourceField) {
      let id = td.closest('tr').dataset.id;
      let sameFieldEls = $data.querySelectorAll(
        `td[data-id="${id}"][data-field="${td.dataset.field}"]`
      );
      if (sameFieldEls.length > 1) {
        sameFieldEls.forEach((el) => {
          el.classList.add('multi-active');
        });
      }
    }
  });
}

// #######################################################
// # SOURCE IMPORT ONLY LOGIC
// #######################################################

if (ORIGIN_TYPE === 'import') {
  let renameFieldModalEl = document.getElementById('rename-field-modal');
  let renameFieldModal = {
    $el: renameFieldModalEl,
    $save: renameFieldModalEl.querySelector('button.save'),
    $input: renameFieldModalEl.querySelector('input[type=text]'),
    $hidden: renameFieldModalEl.querySelector('input[type=hidden]')
  };

  const renameField = function () {
    renameFieldModal.$input.classList.remove('is-invalid');

    let newName = renameFieldModal.$input.value.trim();
    let existingName = renameFieldModal.$hidden.value;
    if (newName && newName !== existingName) {
      renameFieldModal.$input.setAttribute('disabled', 'disabled');
      renameFieldModal.$save.setAttribute('disabled', 'disabled');

      let [match, sourceId, importId] = /\/source\/([^\/]+)\/import\/([^\/]+)/i.exec(
        window.location.pathname
      );
      $api(`/api/source/${sourceId}/import/${importId}/rename`, {
        method: 'PUT',
        body: JSON.stringify({
          id: existingName,
          name: newName
        })
      })
        .then(() => {
          window.location.reload();
        })
        .catch((error) => {
          alert(error && error.message ? error.message : error);
          renameFieldModal.$input.removeAttribute('disabled');
          renameFieldModal.$save.removeAttribute('disabled');
        });
    } else {
      renameFieldModal.$input.classList.add('is-invalid');
    }
  };

  renameFieldModal = {
    $el: renameFieldModalEl,
    $save: renameFieldModalEl.querySelector('button.save'),
    $input: renameFieldModalEl.querySelector('input[type=text]'),
    $hidden: renameFieldModalEl.querySelector('input[type=hidden]')
  };
  renameFieldModal.modal = new bootstrap.Modal(renameFieldModal.$el);
  renameFieldModal.$el.addEventListener('shown.bs.modal', (event) => {
    renameFieldModal.$input.select();
  });
  renameFieldModal.$save.addEventListener('click', renameField);
  renameFieldModal.$input.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      renameField();
    }
  });

  $data.addEventListener('click', (event) => {
    let renameFieldBtn = event.target.closest('.rename-field');
    if (renameFieldBtn) {
      let th = renameFieldBtn.closest('th');
      renameFieldModal.$input.classList.remove('is-invalid');
      renameFieldModal.$input.value = th.dataset.field;
      renameFieldModal.$hidden.value = th.dataset.field;
      renameFieldModal.modal.show();
    }
  });

  document.getElementById('btn-delete-import').addEventListener('click', (event) => {
    let $btn = event.target;
    if (confirm('Are you sure you want to delete this staged import?')) {
      $btn.setAttribute('disabled', 'disabled');

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
          $btn.removeAttribute('disabled');
        });
    }
  });

  document.getElementById('btn-import-records').addEventListener('click', (event) => {
    if (confirm('Are you sure you want to import all the records?')) {
      let $btn = event.target;
      $btn.setAttribute('disabled', 'disabled');
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
          alert(error && error.message ? error.message : error);
          $btn.removeAttribute('disabled');
        });
    }
  });
}

// #######################################################
// # FILTERS
// #######################################################

let currentFilters = {};
let queryWithoutFilters = null;
const allFilters = Array.from($data.querySelectorAll('.table thead th')).reduce(
  (map, el) => {
    if (el.dataset.field) {
      map[el.dataset.field] = el.dataset.name;
    }
    return map;
  },
  // Allow an ID filter param
  { id: 'ID' }
);

const filters = {
  $dropdownBtn: document.querySelector('.dropdown.filters'),
  $dropdown: document.querySelector('.dropdown-menu.filters'),
  $activeFilters: document.getElementById('active-filters'),
  $search: document.getElementById('filter-search')
};

// Select new filter
document.body.addEventListener('click', (event) => {
  let $item = event.target.closest('.add-filter');
  if ($item) {
    let filter = $item.dataset.id;
    currentFilters[filter] = currentFilters[filter] || [];
    addFilter(filter);
  }
});

// Search filter dropdown
filters.$dropdownBtn.addEventListener('shown.bs.dropdown', (event) => {
  filters.$search.select();
});
filters.$search.addEventListener('keyup', (event) => {
  let query = event.target.value.toLowerCase();
  filters.$dropdown.querySelectorAll('.add-filter').forEach((el) => {
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
});

filters.$activeFilters.addEventListener('click', (event) => {
  let $btn = event.target.closest('.btn.remove-filter');
  if ($btn) {
    let filter = $btn.dataset.id;
    let index = $btn.dataset.index;
    currentFilters[filter].splice(index, 1);
    addFilter(filter);
    fetchFilters();
  }
});

filters.$activeFilters.addEventListener('keyup', (event) => {
  if (event.key === 'Enter') {
    let $input = event.target.closest('.filter-input');
    if ($input) {
      let filter = $input.dataset.id;
      currentFilters[filter] = currentFilters[filter] || [];
      let value = $input.value.trim();
      if (value) {
        currentFilters[filter].push(value);
        addFilter(filter);
        fetchFilters();
      }
    }
    return;
  }

  if (event.key === 'Backspace') {
    let $input = event.target.closest('.filter-input');
    if ($input) {
      let filter = $input.dataset.id;
      currentFilters[filter] = currentFilters[filter] || [];
      if (currentFilters[filter].length > 0) {
        currentFilters[filter].splice(currentFilters[filter].length - 1, 1);
        addFilter(filter);
        fetchFilters();
      }
    }
  }
});

const addFilter = function (filter) {
  let html = Object.keys(currentFilters).reduce((html, key) => {
    let values = currentFilters[key];
    let heading = `<strong class="my-0">${allFilters[key]}:</strong>`;
    let buttons = values
      .map((value, index) => {
        return `<button
          type="button"
          class="btn btn-primary btn-sm ms-2 remove-filter"
          data-id="${key}"
          data-index="${index}"
          data-value="${value.replace(/"/g, '"')}"
          title="Remove filter">${value} <span class="ms-2" >&times;</span></button>`;
      })
      .join(' ');

    let input = `<input
        type="text"
        data-id="${key}"
        placeholder="${values.length ? 'or... ' : 'value'}"
        class="filter-input px-2 ms-2" />`;

    return (
      html +
      '<div class="d-flex align-items-center mb-2 mt-2">' +
      heading +
      buttons +
      input +
      '</div>'
    );
  }, '');
  filters.$activeFilters.innerHTML = html;

  if (filter) {
    let inputs = filters.$activeFilters.querySelectorAll(`input[data-id="${filter}"`);
    if (inputs.length) {
      inputs[inputs.length - 1].focus();
    }
  }

  resize();
};

const initFilter = function (filter) {
  let params = new URLSearchParams(window.location.search);
  let filters = {};
  Array.from(params.keys())
    .filter((key) => {
      if (SYSTEM_PARAMS.includes(key)) {
        return false;
      }

      return Object.keys(allFilters).includes(key);
    })
    .forEach((key) => {
      let values = params.getAll(key).filter(Boolean);
      if (values.length) {
        filters[key] = values;
      }
      params.delete(key);
    });
  currentFilters = filters;
  params.delete('offset');
  queryWithoutFilters = params.toString();
  addFilter();
};

const fetchFilters = function () {
  let params = new URLSearchParams();

  Object.keys(currentFilters).forEach((filter) => {
    currentFilters[filter].filter(Boolean).forEach((v) => {
      params.append(filter, v);
    });
  });

  const url = queryWithoutFilters
    ? '?' + queryWithoutFilters + '&' + params.toString()
    : '?' + params.toString();
  fetch(window.location.pathname + url + '&xhr=1')
    .then((response) => {
      return response.text();
    })
    .then((text) => {
      if (url !== window.location.search) {
        window.history.pushState(null, window.location.title, url);
      }

      $data.innerHTML = text;
      updatePaginationPlacement();
      updateExportLinks(getFormPrefs().hiddenFields);
    })
    .catch((error) => {
      let msg = error && error.message ? error.message : error;
      let errorEl = document.getElementById('page-error');
      errorEl.classList.remove('d-none');
      errorEl.innerText = msg;
    });
};

function hideFields(hiddenFields) {
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
        }`
      );
    }, '');

    styleTag = document.createElement('style');
    styleTag.id = 'field-visibility-styles';
    styleTag.textContent = css;
    head.append(styleTag);
  }
}

// #######################################################
// # VISIBLE COLUMNS
// #######################################################

const updateExportLinks = (hidden) => {
  document.querySelectorAll('.export-btn').forEach(($a) => {
    let href = $a.href.replace(/&hidden=[^&]+/i, '');
    if (hidden && hidden.length) {
      $a.href = href + '&hidden=' + encodeURIComponent(hidden.join(','));
    } else {
      $a.href = href;
    }
  });
};

function initFieldToggles(initHiddenFields) {
  const $fieldTogglesBtn = document.getElementById('field-toggles');
  const $fieldToggles = $fieldTogglesBtn.nextElementSibling;
  const $fieldTogglesSearch = document.getElementById('field-toggles-search');
  const allFieldsCount = parseInt($fieldTogglesBtn.querySelector('.all-count').innerText.trim());

  // Search filter dropdown
  $fieldTogglesBtn.addEventListener('shown.bs.dropdown', (event) => {
    $fieldTogglesSearch.select();
  });
  $fieldTogglesSearch.addEventListener('keyup', (event) => {
    let query = event.target.value.toLowerCase();
    $fieldToggles.querySelectorAll('.toggle').forEach((el) => {
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
  });

  $fieldTogglesBtn.addEventListener('hide.bs.dropdown', () => {
    let hidden = Array.from(
      $fieldToggles.querySelectorAll('input[type=checkbox]:not(:checked)')
    ).map((el) => {
      return el.value;
    });

    hideFields(hidden);
    $fieldTogglesBtn.querySelector('.visible-count').innerText = allFieldsCount - hidden.length;
    updateExportLinks(hidden);
    setFormPref('hiddenFields', hidden);
  });

  $fieldToggles.querySelector('.btn.select-all').addEventListener('click', () => {
    $fieldToggles.querySelectorAll('.toggle:not(.d-none) input[type=checkbox]').forEach((el) => {
      el.checked = true;
    });
  });
  $fieldToggles.querySelector('.btn.select-none').addEventListener('click', () => {
    $fieldToggles.querySelectorAll('.toggle:not(.d-none) input[type=checkbox]').forEach((el) => {
      el.checked = false;
    });
  });

  if (initHiddenFields) {
    updateExportLinks(initHiddenFields);
  }
}

function getFormPrefs() {
  return window._prefs || {};
}

function setFormPref(field, value) {
  let prefs = getFormPrefs();
  prefs[field] = value;

  return $api(`/api/user/pref/${ORIGIN_TYPE}/${ORIGIN_ID}`, {
    method: 'POST',
    body: JSON.stringify(prefs)
  }).catch((error) => {
    alert(error && error.message ? error.message : error);
  });
}

// #######################################################
// # Record Source Modal Fetching.
// #######################################################

$data.addEventListener('show.bs.modal', (event) => {
  if (event.target.matches('.modal.record-source.loading')) {
    let url = null;
    if (ORIGIN_TYPE == 'import') {
      let [match, sourceId, importId] = /\/source\/([^\/]+)\/import\/([^\/]+)/i.exec(
        window.location.pathname
      );
      url = `/api/source/${sourceId}/submission/${event.target.dataset.id}?staged=true`;
    } else {
      url = `/api/${ORIGIN_TYPE}/${ORIGIN_ID}/submission/${event.target.dataset.id}`;
    }

    return $api(url, {
      method: 'GET'
    })
      .then((response) => {
        let data = null;
        if (ORIGIN_TYPE === 'view') {
          if (response.results?.length) {
            let index = parseInt(event.target.dataset.index);
            data = response.results[isNaN(index) ? 0 : index].data;
          }
        } else {
          data = response.data;
        }
        event.target.querySelector('.source-json').innerText = JSON.stringify(data, undefined, 2);
      })
      .catch((error) => {
        event.target.querySelector('.source-json').innerText = error.message
          ? error.message
          : error;
      })
      .finally(() => {
        event.target.classList.remove('loading');
      });
  }
});

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

  $createModal.querySelector('.btn.save').addEventListener('click', (event) => {
    let $save = event.target;
    $save.setAttribute('disabled', 'disabled');
    $save.previousElementSibling.classList.remove('d-none');
    $createModal.querySelector('.btn-close').setAttribute('disabled', 'disabled');

    let submission = {};
    $createModal.querySelectorAll('.field-value').forEach(($input) => {
      let value = $input.value.trim();
      if (value) {
        submission[$input.name] = value;
      }
    });

    $api(`/api/source/${ORIGIN_ID}/submission`, {
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
        $save.removeAttribute('disabled');
        $save.previousElementSibling.classList.add('d-none');
        $createModal.querySelector('.btn-close').removeAttribute('disabled');
      });
  });
}

// #######################################################
// # PAGINATION NAV LOGIC
// #######################################################

function updatePaginationPlacement() {
  let $top = document.getElementById('top-pagination');
  $top.innerHTML = '';

  let $nav = data.querySelector('#data .top-pagination');
  if ($nav) {
    $top.appendChild($nav);
    $nav.classList.remove('d-none');
  }
}

// #######################################################
// # ATTACHMENT MODAL LOGIC
// #######################################################

document.addEventListener('click', (event) => {
  let rotateBtn = event.target.closest('.rotate-btn');
  if (rotateBtn) {
    let angle = 0;
    let diff = rotateBtn.classList.contains('counter-clockwise') ? -90 : 90;
    let img = rotateBtn.closest('.modal-dialog').querySelector('.modal-body img');
    let style = /rotate\((\d+)deg\)/i.exec(img.style.transform);
    if (style) {
      angle = parseInt(style[1]);
    }

    if (diff < 0 && angle === 0) {
      angle = 270;
    } else {
      angle = angle + diff;
    }
    img.style.transform = `rotate(${angle}deg)`;
  }

  let deleteAttachmentBtn = event.target.closest('.delete-attachment');
  if (deleteAttachmentBtn && confirm('Are you sure you want to delete this file?')) {
    updateSubmission(
      deleteAttachmentBtn.dataset.submissionId,
      deleteAttachmentBtn.dataset.fieldName,
      '',
      deleteAttachmentBtn.dataset.name
    ).then(() => {
      // Remove attachment backdrop remnants.
      document.body.classList.remove('modal-open');
      document.body.style = '';
      let backdrop = document.querySelector('body > .modal-backdrop.show');
      if (backdrop) {
        document.body.removeChild(backdrop);
      }
    });
  }
});

// Global attachment image error handler. Registered inline on images from _attachment.njk
window.onAttachmentPreviewError = function (img) {
  let modal = img.parentElement.closest('.modal-content');
  if (modal) {
    modal.querySelectorAll('.rotate-btn').forEach((el) => {
      el.setAttribute('disabled', 'disabled');
    });
  }
  img.parentElement.innerText = 'No preview available';
};

// #######################################################
// # INIT
// #######################################################

function resize() {
  let headerRect = document.body.querySelector('main > header').getBoundingClientRect();
  $data.style.height = window.innerHeight - (headerRect.top + headerRect.height) + 'px';
}

function onLoad() {
  initFilter();
  updatePaginationPlacement();

  // Init Bootstrap popovers (help tips)
  document.querySelectorAll('[data-bs-toggle="popover"]').forEach((popoverTriggerEl) => {
    return new bootstrap.Popover(popoverTriggerEl);
  });

  // Focus on first row so keyboard works well with up/down.
  document.querySelector('tbody tr').focus();

  // When we use arrow keys, focus on data for scrolling.
  window.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      if (event.target.closest('input[type=text],select,textarea,.dropdown-menu.modal') === null) {
        document.querySelector('tbody tr').focus();
      }
    }
  });

  let prefs = getFormPrefs();
  initFieldToggles(prefs.hiddenFields);
  document.getElementById('data-loader').classList.add('d-none');
  window.addEventListener('resize', resize);
}

onLoad();

