var http = require('http')
	, fs = require('fs')
	, path = require('path')
	, request = require('request')
	, routeConfig = require(process.argv.pop())
	, PORT = 4040;

var routeConfigLen = routeConfig.proxies.length,
	urlRegexes = [];

process.on('uncaughtException', function (err) {
  console.log('Caught exception: ' + err);
});

/**
 * Backbone's method for creating a RegEx out of a URL
 * pattern. We'll use this to detect regular routes and
 * generic routes like /users/:userid
 */
var optionalParam = /\((.*?)\)/g;
var namedParam    = /(\(\?)?:\w+/g;
var splatParam    = /\*\w+/g;
var escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g;

var _routeToRegExp = function(route) {
	route = route.replace(escapeRegExp, '\\$&')
		.replace(optionalParam, '(?:$1)?')
		.replace(namedParam, function(match, optional) {
		 return optional ? match : '([^/?]+)';
		})
		.replace(splatParam, '([^?]*?)');
	return new RegExp('^' + route + '(?:\\?(.*))?$');
}

/**
 * Go through the canned URLs and create regexes out of them
 */
if (routeConfig.canned) {
	for (var c in routeConfig.canned) {
		urlRegexes.push({
			regex: _routeToRegExp(c),
			path: routeConfig.canned[c]
		});
	}
}

var urlRegexesLen = urlRegexes.length,
	foundCannedResponse = false;

function cannedResponseHandler(req, res) {
	foundCannedResponse = false;

	for (var i = 0; i < urlRegexesLen; i++) {
		if (urlRegexes[i].regex.test(req.url)) {
			foundCannedResponse = true;
			break;
		}
	}

	if (foundCannedResponse === false)
		return false;

	var file = path.join(__dirname, urlRegexes[i].path);
	console.log("Shipping canned response %s %s", req.method, req.url);
	fs.stat(file, function(err, stat) {
		res.writeHead(200, {
			'Content-Type': 'application/json',
			'Content-Length': stat.size,
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Headers': 'X-Requested-With'
		});

		fs.createReadStream(file).pipe(res);
	});

	return true;
}

var host;

var allowedHeaders = [
	"Authorization",
	"Content-Type",
	"X-Requested-With",
	"X-Proxy-Host"
];

http.createServer(function(req, res) {
	res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
	res.setHeader("Access-Control-Allow-Headers", allowedHeaders.join(", "));
	res.setHeader("Access-Control-Allow-Credentials", "true");

	if (cannedResponseHandler(req, res))
		return;

	var splitReq = req.url.split('/');
	if (splitReq.length <= 1)
		return;

	if (req.headers['x-proxy-host']) {
		host = req.headers['x-proxy-host'];
	} else {
		for (var i = 0; i < routeConfigLen; i++) {
			if (req.url.indexOf(routeConfig.proxies[i].proxyURL) === 0) {
				host = routeConfig.proxies[i].host + '/';
				req.url = req.url.substr(routeConfig.proxies[i].proxyURL.length);
				break;
			}
		}
	}

	var formattedUrl = host + req.url;
	var options = {
		url: formattedUrl,
		method: req.method,
		headers: {
			  Authorization: req.headers.authorization
			, 'User-Agent': req.headers['user-agent']
			, Connection: req.headers.connection
			, cookie: req.headers.cookie
			, 'Content-Type': req.headers['content-type']
		},
		body: ""
	};

	console.log("Proxying %s %s", req.method, options.url);

	req.on('data', function (data) {
		options.body += data;
	});
	req.on('end', function () {
		request(options, function(err, response, body) {
      var headerName;

      for (var headerName in response.headers) {
        res.setHeader(headerName, response.headers[headerName]);
      }

			res.end(body);
		});
	});


}).listen(PORT);

console.log("server pid %s listening on port %s", process.pid, PORT);
