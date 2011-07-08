if (typeof Cc == "undefined")
  eval("const Cc = Components.classes");
if (typeof Ci == "undefined")
  eval("const Ci = Components.interfaces");
if (typeof Cr == "undefined")
  eval("const Cr = Components.results");
if (typeof Cu == "undefined")
  eval("const Cu = Components.utils");

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

var geckoVersion = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo).platformVersion;
function compareGeckoVersion(version)
{
  Cu.import(baseURL.spec + "Utils.jsm");
  return Utils.versionComparator.compare(geckoVersion, version);
}

function prepareFilterComponents(keepObservers)
{
  Cu.import(baseURL.spec + "FilterClasses.jsm");
  Cu.import(baseURL.spec + "SubscriptionClasses.jsm");
  window.FilterStorageGlobal = Cu.import(baseURL.spec + "FilterStorage.jsm");
  Cu.import(baseURL.spec + "Matcher.jsm");
  window.ElemHideGlobal = Cu.import(baseURL.spec + "ElemHide.jsm");
  Cu.import(baseURL.spec + "FilterListener.jsm");

  let oldSubscriptions = FilterStorage.subscriptions;
  let oldStorageKnown = FilterStorage.knownSubscriptions;
  let oldSubscriptionsKnown = Subscription.knownSubscriptions;
  let oldFiltersKnown = Filter.knownFilters;
  let oldObservers = FilterStorageGlobal.observers;
  let oldSourceFile = FilterStorage.__lookupGetter__("sourceFile");

  FilterStorage.subscriptions = [];
  FilterStorage.knownSubscriptions = {__proto__: null};
  Subscription.knownSubscriptions = {__proto__: null};
  Filter.knownFilters = {__proto__: null};
  if (!keepObservers)
  {
    FilterStorageGlobal.observers = [];
  }

  defaultMatcher.clear();
  ElemHide.clear();

  window.addEventListener("unload", function()
  {
    FilterStorage.subscriptions = oldSubscriptions;
    FilterStorage.knownSubscriptions = oldStorageKnown;
    Subscription.knownSubscriptions = oldSubscriptionsKnown;
    Filter.knownFilters = oldFiltersKnown;
    FilterStorageGlobal.observers = oldObservers;
    FilterStorage.__defineGetter__("sourceFile", oldSourceFile);

    FilterStorage.triggerObservers("load");
  }, false);

  try
  {
    // Disable timeline functions, they slow down tests otherwise
    Cu.import(baseURL.spec + "TimeLine.jsm");

    let oldTimelineLog = TimeLine.log;
    let oldTimelineEnter = TimeLine.enter;
    let oldTimelineLeave = TimeLine.leave;

    TimeLine.log = function(){};
    TimeLine.enter = function(){};
    TimeLine.leave = function(){};

    window.addEventListener("unload", function()
    {
      TimeLine.log = oldTimelineLog;
      TimeLine.enter = oldTimelineEnter;
      TimeLine.leave = oldTimelineLeave;
    }, false);
  }
  catch(e)
  {
    // TimeLine module might not be present, catch exceptions
    alert(e);
  }
}

function preparePrefs()
{
  Cu.import(baseURL.spec + "Prefs.jsm");

  let backup = {__proto__: null};
  let getters = {__proto__: null}
  for (let pref in Prefs)
  {
    if (Prefs.__lookupSetter__(pref))
      backup[pref] = Prefs[pref];
    else if (Prefs.__lookupGetter__(pref))
      getters[pref] = Prefs.__lookupGetter__(pref);
  }
  Prefs.enabled = true;

  window.addEventListener("unload", function()
  {
    for (let pref in backup)
      Prefs[pref] = backup[pref];
    for (let pref in getters)
      Prefs.__defineGetter__(pref, getters[pref]);
  }, false);
}

function showProfilingData(debuggerService)
{
  let scripts = [];
  debuggerService.enumerateScripts({
    enumerateScript: function(script)
    {
      scripts.push(script);
    }
  });
  scripts = scripts.filter(function(script)
  {
    return script.fileName.indexOf("chrome://adblockplus/") == 0 && script.callCount > 0;
  });
  scripts.sort(function(a, b)
  {
    return b.totalOwnExecutionTime - a.totalOwnExecutionTime;
  });

  let table = document.createElement("table");
  table.setAttribute("border", "border");

  let header = table.insertRow(-1);
  header.style.fontWeight = "bold";
  header.insertCell(-1).textContent = "Function name";
  header.insertCell(-1).textContent = "Call count";
  header.insertCell(-1).textContent = "Min execution time (total/own)";
  header.insertCell(-1).textContent = "Max execution time (total/own)";
  header.insertCell(-1).textContent = "Total execution time (total/own)";

  for each (let script in scripts)
    showProfilingDataForScript(script, table);

  document.getElementById("display").appendChild(table);
}

function showProfilingDataForScript(script, table)
{
  let functionName = script.functionName;
  if (functionName == "anonymous")
    functionName = guessFunctionName(script.fileName, script.baseLineNumber);

  let row = table.insertRow(-1);
  row.insertCell(-1).innerHTML = functionName + "<br/>\n" + script.fileName.replace("chrome://adblockplus/", "") + ":" + script.baseLineNumber;
  row.insertCell(-1).textContent = script.callCount;
  row.insertCell(-1).textContent = script.minExecutionTime.toFixed(2) + "/" + script.minOwnExecutionTime.toFixed(2);
  row.insertCell(-1).textContent = script.maxExecutionTime.toFixed(2) + "/" + script.maxOwnExecutionTime.toFixed(2);
  row.insertCell(-1).textContent = script.totalExecutionTime.toFixed(2) + "/" + script.totalOwnExecutionTime.toFixed(2);
}

let fileCache = {};
function guessFunctionName(fileName, lineNumber)
{
  if (!(fileName in fileCache))
  {
    try
    {
      let request = new XMLHttpRequest();
      request.open("GET", fileName, false);
      request.overrideMimeType("text/plain");
      request.send(null);
      fileCache[fileName] = request.responseText.split(/\n/);
    }
    catch (e)
    {
      return "anonymous";
    }
  }

  let data = fileCache[fileName];

  lineNumber--;
  if (lineNumber >= 0 && lineNumber < data.length && /(\w+)\s*[:=]\s*function/.test(data[lineNumber]))
    return RegExp.$1;

  lineNumber--;
  if (lineNumber >= 0 && lineNumber < data.length && /(\w+)\s*[:=]\s*function/.test(data[lineNumber]))
    return RegExp.$1;

  return "anonymous";
}

if (/[?&]profiler/i.test(location.href))
{
  let debuggerService = Cc["@mozilla.org/js/jsd/debugger-service;1"].getService(Ci.jsdIDebuggerService);

  let oldFinish = SimpleTest.finish;
  SimpleTest.finish = function()
  {
    showProfilingData(debuggerService);
    debuggerService.off();
    return oldFinish.apply(this, arguments);
  }
  window.addEventListener("unload", function()
  {
    debuggerService.off();
  }, true);
  debuggerService.on();
  debuggerService.flags |= debuggerService.COLLECT_PROFILE_DATA;
  debuggerService.clearProfileData();
}