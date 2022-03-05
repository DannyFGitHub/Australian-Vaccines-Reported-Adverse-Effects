var SQL_FROM_REGEX = /FROM\s+([^\s;]+)/im;
var SQL_LIMIT_REGEX = /LIMIT\s+(\d+)(?:\s*,\s*(\d+))?/im;
var SQL_SELECT_REGEX = /SELECT\s+[^;]+\s+FROM\s+/im;

var db = null;
var rowCounts = [];
var editor = ace.edit("sql-editor");
var bottomBarDefaultPos = null,
  bottomBarDisplayStyle = null;
var errorBox = $("#error");
var lastCachedQueryCount = {};

$.urlParam = function (name) {
  var results = new RegExp("[?&]" + name + "=([^&#]*)").exec(
    window.location.href
  );
  if (results == null) {
    return null;
  } else {
    return results[1] || 0;
  }
};

var selectFormatter = function (item) {
  var index = item.text.indexOf("(");
  if (index > -1) {
    var name = item.text.substring(0, index);
    return (
      name +
      '<span style="color:#ccc">' +
      item.text.substring(index - 1) +
      "</span>"
    );
  } else {
    return item.text;
  }
};

var windowResize = function () {
  positionFooter();
  var container = $("#main-container");
  var cleft = container.offset().left + container.outerWidth();
  $("#bottom-bar").css("left", cleft);
};

var positionFooter = function () {
  var footer = $("#bottom-bar");
  var pager = footer.find("#pager");
  var container = $("#main-container");
  var containerHeight = container.height();
  var footerTop = $(window).scrollTop() + $(window).height();

  if (bottomBarDefaultPos === null) {
    bottomBarDefaultPos = footer.css("position");
  }

  if (bottomBarDisplayStyle === null) {
    bottomBarDisplayStyle = pager.css("display");
  }

  if (footerTop > containerHeight) {
    footer.css({
      position: "static",
    });
    pager.css("display", "inline-block");
  } else {
    footer.css({
      position: bottomBarDefaultPos,
    });
    pager.css("display", bottomBarDisplayStyle);
  }
};

//Initialize editor
editor.setTheme("ace/theme/chrome");
editor.renderer.setShowGutter(false);
editor.renderer.setShowPrintMargin(false);
editor.renderer.setPadding(20);
editor.renderer.setScrollMargin(8, 8, 0, 0);
editor.setHighlightActiveLine(false);
editor.getSession().setUseWrapMode(true);
editor.getSession().setMode("ace/mode/sql");
editor.setOptions({ maxLines: 5 });
editor.setFontSize(16);

//Update pager position
$(window).resize(windowResize).scroll(positionFooter);
windowResize();

$(".no-propagate").on("click", function (el) {
  el.stopPropagation();
});

//Check url to load remote DB
var loadUrlDB = "CaseListings.sqlite3"; //$.urlParam("url");
var xhr = new XMLHttpRequest();
xhr.open("GET", decodeURIComponent(loadUrlDB), true);
xhr.responseType = "arraybuffer";

xhr.onload = function (e) {
  loadDB(this.response);
};
xhr.onerror = function (e) {
  setIsLoading(false);
};
xhr.send();

function loadDB(arrayBuffer) {
  setIsLoading(true);

  resetTableList();

  initSqlJs().then(function (SQL) {
    var tables;
    try {
      db = new SQL.Database(new Uint8Array(arrayBuffer));

      //Get all table names from master table
      tables = db.prepare(
        "SELECT * FROM sqlite_master WHERE type='table' OR type='view' ORDER BY name"
      );
    } catch (ex) {
      setIsLoading(false);
      alert(ex);
      return;
    }

    var firstTableName = null;
    var tableList = $("#tables");

    while (tables.step()) {
      var rowObj = tables.getAsObject();
      var name = rowObj.name;

      if (firstTableName === null) {
        firstTableName = name;
      }
      var rowCount = getTableRowsCount(name);
      rowCounts[name] = rowCount;
      tableList.append(
        '<option value="' +
          name +
          '">' +
          name +
          " (" +
          rowCount +
          " rows)</option>"
      );
    }

    //Select first table and show It
    tableList.select2("val", firstTableName);
    doDefaultSelect(firstTableName);

    $("#output-box").fadeIn();
    $(".nouploadinfo").hide();
    $("#sample-db-link").hide();
    $("#success-box").show();

    // setIsLoading(false);
  });
}

function getTableRowsCount(name) {
  var sel = db.prepare("SELECT COUNT(*) AS count FROM '" + name + "'");
  if (sel.step()) {
    return sel.getAsObject().count;
  } else {
    return -1;
  }
}

function getQueryRowCount(query) {
  if (query === lastCachedQueryCount.select) {
    return lastCachedQueryCount.count;
  }

  var queryReplaced = query.replace(
    SQL_SELECT_REGEX,
    "SELECT COUNT(*) AS count_sv FROM "
  );

  if (queryReplaced !== query) {
    queryReplaced = queryReplaced.replace(SQL_LIMIT_REGEX, "");
    var sel = db.prepare(queryReplaced);
    if (sel.step()) {
      var count = sel.getAsObject().count_sv;

      lastCachedQueryCount.select = query;
      lastCachedQueryCount.count = count;

      return count;
    } else {
      return -1;
    }
  } else {
    return -1;
  }
}

function getTableColumnTypes(tableName) {
  var result = [];
  var sel = db.prepare("PRAGMA table_info('" + tableName + "')");

  while (sel.step()) {
    var obj = sel.getAsObject();
    result[obj.name] = obj.type;
    /*if (obj.notnull === 1) {
            result[obj.name] += " NOTNULL";
        }*/
  }

  return result;
}

function resetTableList() {
  var tables = $("#tables");
  rowCounts = [];
  tables.empty();
  tables.append("<option></option>");
  tables.select2({
    placeholder: "Select a table",
    formatSelection: selectFormatter,
    formatResult: selectFormatter,
  });
  tables.on("change", function (e) {
    doDefaultSelect(e.val);
  });
}

function setIsLoading(isLoading) {
  var loading = $("#loading-box");
  if (isLoading) {
    loading.show();
  } else {
    loading.hide();
  }
}

function doDefaultSelect(name) {
  var defaultSelect = "SELECT * FROM '" + name + "' LIMIT 0,30";
  editor.setValue(defaultSelect, -1);
  renderQuery(defaultSelect);
}

function executeSql() {
  var query = editor.getValue();
  renderQuery(query);
  $("#tables").select2("val", getTableNameFromQuery(query));
}

function getTableNameFromQuery(query) {
  var sqlRegex = SQL_FROM_REGEX.exec(query);
  if (sqlRegex != null) {
    return sqlRegex[1].replace(/"|'/gi, "");
  } else {
    return null;
  }
}

function parseLimitFromQuery(query, tableName) {
  var sqlRegex = SQL_LIMIT_REGEX.exec(query);
  if (sqlRegex != null) {
    var result = {};

    if (sqlRegex.length > 2 && typeof sqlRegex[2] !== "undefined") {
      result.offset = parseInt(sqlRegex[1]);
      result.max = parseInt(sqlRegex[2]);
    } else {
      result.offset = 0;
      result.max = parseInt(sqlRegex[1]);
    }

    if (result.max == 0) {
      result.pages = 0;
      result.currentPage = 0;
      return result;
    }

    if (typeof tableName === "undefined") {
      tableName = getTableNameFromQuery(query);
    }

    var queryRowsCount = getQueryRowCount(query);
    if (queryRowsCount != -1) {
      result.pages = Math.ceil(queryRowsCount / result.max);
    }
    result.currentPage = Math.floor(result.offset / result.max) + 1;
    result.rowCount = queryRowsCount;

    return result;
  } else {
    return null;
  }
}

function setPage(el, next) {
  if ($(el).hasClass("disabled")) return;

  var query = editor.getValue();
  var limit = parseLimitFromQuery(query);

  var pageToSet;
  if (typeof next !== "undefined") {
    pageToSet = next ? limit.currentPage : limit.currentPage - 2;
  } else {
    var page = prompt("Go to page");
    if (!isNaN(page) && page >= 1 && page <= limit.pages) {
      pageToSet = page - 1;
    } else {
      return;
    }
  }

  var offset = pageToSet * limit.max;
  editor.setValue(
    query.replace(SQL_LIMIT_REGEX, "LIMIT " + offset + "," + limit.max),
    -1
  );

  executeSql();
}

function refreshPagination(query, tableName) {
  var limit = parseLimitFromQuery(query, tableName);
  if (limit !== null && limit.pages > 0) {
    var pager = $("#pager");
    pager.attr("title", "Row count: " + limit.rowCount);
    pager.tooltip("_fixTitle");
    pager.text(limit.currentPage + " / " + limit.pages);

    if (limit.currentPage <= 1) {
      $("#page-prev").addClass("disabled");
    } else {
      $("#page-prev").removeClass("disabled");
    }

    if (limit.currentPage + 1 > limit.pages) {
      $("#page-next").addClass("disabled");
    } else {
      $("#page-next").removeClass("disabled");
    }

    $("#bottom-bar").show();
  } else {
    $("#bottom-bar").hide();
  }
}

function showError(msg) {
  $("#data").hide();
  $("#bottom-bar").hide();
  errorBox.show();
  errorBox.text(msg);
}

function htmlEncode(value) {
  return $("<div/>").text(value).html();
}

function renderQueryInCardsGrid(query) {
  var dataBox = $("#data-cards");
  errorBox.hide();
  dataBox.empty();
  dataBox.show();

  var columnTypes = [];
  var tableName = getTableNameFromQuery(query);
  if (tableName != null) {
    columnTypes = getTableColumnTypes(tableName);
  }

  var sel;
  try {
    sel = db.prepare(query);
  } catch (ex) {
    showError(ex);
    return;
  }

  while (sel.step()) {
    // var row = sel.getAsObject();
    // var card = $("<div class='card'></div>");
    // var cardBody = $("<div class='card-body'></div>");
    // var cardText = $("<p class='card-text'></p>");
    // for (var i = 0; i < row.length; i++) {
    //   var value = row[i];
    //   if (typeof value === "undefined") {
    //     value = "";
    //   }
    //   var columnType = columnTypes[i];
    //   if (columnType == "TEXT") {
    //     value = htmlEncode(value);
    //   }
    //   cardText.append(
    //     "<span class='badge badge-secondary'>" +
    //       columnTypes[i] +
    //       "</span> " +
    //       value +
    //       "<br>"
    //   );
    // }
    // cardBody.append("<h6 class='card-title'>" + tableName + "</h6>");
    // cardBody.append(cardText);
    // card.append(cardBody);
    // for (var i = 0; i < columnNames.length; i++) {
    // var type = columnTypes[columnNames[i]];
    // // Create row class div with bootstrap card inside
    // dataBox.append(
    //   '<div class="card">' +
    //     '<div class="card-body">' +
    //     '<div class="card-body-inner">' +
    //     "<span>" +
    //     columnNames[i] +
    //     "</span>" +
    //     "</div>" +
    //     "</div>" +
    //     '<div class="card-footer">' +
    //     '<div class="card-footer-inner">' +
    //     "<span>" +
    //     // htmlEncode(sel.getString(i)) +
    //     JSON.stringify() +
    //     "</span>" +
    //     "</div>" +
    //     "</div>" +
    //     "</div>"
    // );
    // }
    // var tr = $("<div>");
    // var s = sel.get;
    // for (var i = 0; i < s.length; i++) {
    //   tr.append(
    //     '<div><span title="' +
    //       htmlEncode(s[i]) +
    //       '">' +
    //       htmlEncode(s[i]) +
    //       "</span></div>"
    //   );
    // }
    // dataBox.append(card);
  }

  refreshPagination(query, tableName);

  setTimeout(function () {
    positionFooter();
  }, 100);
}

function renderQuery(query) {
  renderQueryInCardsGrid(query);

  var dataBox = $("#data");
  var thead = dataBox.find("thead").find("tr");
  var tbody = dataBox.find("tbody");

  thead.empty();
  tbody.empty();
  errorBox.hide();
  dataBox.show();

  var columnTypes = [];
  var tableName = getTableNameFromQuery(query);
  if (tableName != null) {
    columnTypes = getTableColumnTypes(tableName);
  }

  var sel;
  try {
    sel = db.prepare(query);
  } catch (ex) {
    showError(ex);
    return;
  }

  var addedColums = false;
  while (sel.step()) {
    if (!addedColums) {
      addedColums = true;
      var columnNames = sel.getColumnNames();
      for (var i = 0; i < columnNames.length; i++) {
        var type = columnTypes[columnNames[i]];
        thead.append(
          '<th><span data-bs-toggle="tooltip" data-bs-placement="top" data-bs-html="true" title="' +
            type +
            '">' +
            columnNames[i] +
            "</span></th>"
        );
      }
    }

    var tr = $("<tr>");
    var s = sel.get();
    for (var i = 0; i < s.length; i++) {
      tr.append(
        '<td><span title="' +
          htmlEncode(s[i]) +
          '">' +
          htmlEncode(s[i]) +
          "</span></td>"
      );
    }
    tbody.append(tr);
  }

  refreshPagination(query, tableName);

  $('[data-bs-toggle="tooltip"]').tooltip({ html: true });
  dataBox.editableTableWidget();

  setTimeout(function () {
    positionFooter();
    setIsLoading(false);
  }, 100);
}
