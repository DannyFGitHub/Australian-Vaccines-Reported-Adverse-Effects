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

    setIsLoading(false);
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

function camelCaseToCapitalisation(value) {
  var valueText = value.replace(/([A-Z])/g, " $1");
  valueText = valueText.charAt(0).toUpperCase() + valueText.slice(1);
  valueText = htmlEncode(valueText);
  return valueText;
}

function renderQueryInCardsGrid(query) {
  var dataBox = $("#data-cards");
  errorBox.hide();
  dataBox.html("");
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
    var column = $("<div class='col'></div>");
    var card = $("<div class='card h-100 text-dark bg-light mb-3'></div>");
    var cardHeader = $("<div class='card-header'></div>");
    var cardBody = $("<div class='card-body'></div>");
    var cardText = $("<div class='row'></p>");
    var cardFooter = $("<div class='card-footer row'></div>");
    var row = sel.getAsObject();

    var meddraReactionTerms = "meddraReactionTerms";
    cardText.append(
      "<div class='col-12'><div><strong>" +
        camelCaseToCapitalisation(meddraReactionTerms) +
        '</strong></div><div class="row">' +
        htmlEncode(row[meddraReactionTerms])
          .split(",")
          .map((v) => {
            return "<div class='col-4'><small>" + v + "</small></div>";
          })
          .join("") +
        "</div></div>"
    );

    var medicinesReportedAsBeingTaken = "medicinesReportedAsBeingTaken";
    cardText.append(
      "<div class='col-12'><div><strong>" +
        camelCaseToCapitalisation(medicinesReportedAsBeingTaken) +
        "</strong></div>" +
        htmlEncode(row.medicinesReportedAsBeingTaken)
          .split(",")
          .map((v) => {
            return "<p><small>" + v + "</small></p>";
          })
          .join("") +
        "</div>"
    );

    var caseNumber = "caseNumber";
    cardFooter.append(
      "<div class='col-6'><small>" +
        camelCaseToCapitalisation(caseNumber) +
        ":</small> <span>" +
        row[caseNumber] +
        "</span></div>"
    );

    var reportEntryDate = "reportEntryDate";
    let reportEntryDateStringValue = "";
    try {
      reportEntryDateStringValue = new Date(
        row[reportEntryDate]
      ).toLocaleDateString();
    } catch (e) {}
    cardFooter.append(
      "<div class='col-6'><small>" +
        camelCaseToCapitalisation(reportEntryDate) +
        ":</small> <span>" +
        reportEntryDateStringValue +
        "</span></div>"
    );

    cardHeader.append(tableName);

    var age = "age";
    var gender = "gender";
    cardBody.append(
      "<h6 class='card-title'><div><small>" +
        camelCaseToCapitalisation(age) +
        ":</small> " +
        row[age] +
        "</div><div>" +
        "<small>" +
        camelCaseToCapitalisation(gender) +
        ":</small> " +
        row[gender] +
        "</div></h6>"
    );

    cardBody.append(cardText);
    card.append(cardHeader);
    card.append(cardBody);
    card.append(cardFooter);

    column.append(card);
    dataBox.append(column);
  }
}

function renderQuery(query) {
  $("#data-cards").html("");
  $("#data").hide();

  if ($("#flexSwitchViewType").is(":checked")) {
    renderQueryInCardsGrid(query);
  } else {
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

    dataBox.editableTableWidget();
  }

  refreshPagination(query, tableName);

  $('[data-bs-toggle="tooltip"]').tooltip({ html: true });

  setTimeout(function () {
    positionFooter();
  }, 100);
}
