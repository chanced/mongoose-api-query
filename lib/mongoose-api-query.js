module.exports = exports = function apiQueryPlugin(schema, opts) {
  opts = opts || {}

  if(!opts.maxDistance){
    opts.maxDistance = { dist: 10, unit: 'mi' }
  } else if('string' === typeof(opts.maxDistance)){
    var input = opts.maxDistance;
    opts.maxDistance = {
      dist: input.match(/[\d]*/),
      unit: input.match(/[\w]*/)
    }
  }

  schema.statics.apiQuery = function(rawParams, cb) {
    var model = this,
      params = model.apiQueryParams(rawParams);
    // Create the Mongoose Query object.
    var query = model.find(params.searchParams)
      .limit(params.per_page)
      .skip((params.page - 1) * params.per_page)

    if (params.sort) {
      query = query.sort(params.sort)
    }
    if (cb) {
      query.exec(cb);
    } else {
      return query;
    }
  };

  schema.statics.apiQueryParams = function(rawParams) {

    var model = this;
    var convertToBoolean = function(str) {
      return (["true", "t", "yes", "y"].indexOf(str.toLowerCase()) !== -1)
    };

    var searchParams = {},
      query, page = 1,
      per_page = 10,
      sort = false;

    var parseSchemaForKey = function(schema, keyPrefix, lcKey, val, ƒ) {
      var paramType = false;
      var addSearchParam = function(val) {
        var key = keyPrefix + lcKey;
        if (typeof searchParams[key] !== 'undefined') {
          for (var i in val) {
            searchParams[key][i] = val[i];
          }
        } else {
          searchParams[key] = val;
        }
      };
      var matches = lcKey.match(/(.+)\.(.+)/)
      if (matches) {
        // parse subschema
        var pathKey = schema.paths[matches[1]];
        var constructorName = pathKey.constructor.name;

        if (["DocumentArray", "Mixed"].indeOf(constructorName) !== -1) {
          parseSchemaForKey(pathKey.schema, matches[1] + ".", matches[2], val, ƒ)
        }
      }
      else if (typeof schema === "undefined") {
        paramType = "String";

      }
      else if (ƒ === "near") {

        paramType = "Near";
      }

      else {
        var constructorName = schema.paths[lcKey].constructor.name;
        console.log(constructorName)
        var nameMatch = {
          "SchemaBoolean": "Boolean",
          "SchemaString": "String",
          "ObjectId": "ObjectId",
          "SchemaNumber": "Number"
        };

        paramType = nameMatch[constructorName] || false
      }

      if (paramType === "Boolean") {

        addSearchParam(convertToBoolean(val));

      }
      else if (paramType === "Number") {
        if (val.match(/([0-9]+,?)/) && val.match(',')) {
          if (ƒ === "all") {
            addSearchParam({
              $all: val.split(',')
            });
          } else if (ƒ === "nin") {
            addSearchParam({
              $nin: val.split(',')
            });
          } else if (ƒ === "mod") {
            addSearchParam({
              $mod: [val.split(',')[0], val.split(',')[1]]
            });
          } else {
            addSearchParam({
              $in: val.split(',')
            });
          }
        } else if (val.match(/([0-9]+)/)) {
          if (["gt", "gte", "lt", "lte", "ne"].indexOf(ƒ) != -1) {
            var newParam = {};
            newParam["$" + ƒ] = val
            addSearchParam(newParam);
          } else {
            addSearchParam(parseInt(val));
          }
        }
      }
      else if (paramType === "String") {
        if (val.match(',')) {
          var options = val.split(',')
            .map(function(str) {
              return new RegExp(str, 'i');
            });

          if (ƒ === "all") {
            addSearchParam({
              $all: options
            });
          } else if (ƒ === "nin") {
            addSearchParam({
              $nin: options
            });
          } else {
            addSearchParam({
              $in: options
            });
          }
        } else if (val.match(/^[0-9]+$/)) {
          if (ƒ === "gt" ||
            ƒ === "gte" ||
            ƒ === "lt" ||
            ƒ === "lte") {
            var newParam = {};
            newParam["$" + ƒ] = val;
            addSearchParam(newParam);
          } else {
            addSearchParam(val);
          }
        } else if (ƒ === "ne" || ƒ === "not") {
          var neregex = new RegExp(val, "i");
          addSearchParam({
            '$not': neregex
          });
        } else if (ƒ === "exact") {
          addSearchParam(val);
        } else {
          addSearchParam({
            $regex: val,
            $options: "-i"
          });
        }
      }
      else if (paramType === "Near") {
        var nearParams = val.split(',');
        var geoFilter = {}
        var maxDistance =  10
        if(nearParams.length > 2){
          maxDistance = parseFloat(nearParams[2]) || maxDistance
          nearParams = nearParams.splice(0, 2)
        }
        maxDistance = ((maxDistance > 0) ? maxDistance : 10) * 1609.34;

        if (nearParams.length > 1) {
          var lat = nearParams[1]
          var lng = nearParams[0]
          lat = parseFloat(lat)
          lng = parseFloat(lng)
          console.log('lat', lat)
          console.log('lng', lng)
          if(lat && lng){
            geoFilter.$near = {
              $geometry: {
                type: "Point",
                coordinates: [lng, lat],
                spherical: true
              },
              $maxDistance: maxDistance
            }
            addSearchParam(geoFilter);
          }
        }
      }
      else if (paramType === "ObjectId") {

      addSearchParam(val);
      }
    };

    var parseParam = function(key, val) {
      var lcKey = key,
        ƒ = val.match(/\{(.*)\}/),
        val = val.replace(/\{(.*)\}/, '');

      if (ƒ) ƒ = ƒ[1];

      if (val === "") {
        return;
      } else if (lcKey === "page") {
        page = val;
      } else if (lcKey === "per_page" && !isNaN(val)) {
        var parsedVal = Math.abs(parseInt(val));
        if (parsedVal > 1) {
          per_page = parsedVal
        }
      } else if (lcKey === "sort_by") {
        var parts = val.split(',');
        sort = {};
        sort[parts[0]] = parts.length > 1 ? parts[1] : 1;
      } else {
        parseSchemaForKey(model.schema, "", lcKey, val, ƒ);
      }
    }

   // Construct searchParams
    for (var key in rawParams) {
      var separatedParams = rawParams[key].match(/\{\w+\}(.[^\{\}]*)/g);

      if (separatedParams === null) {
        parseParam(key, rawParams[key]);
      } else {
        for (var i = 0, len = separatedParams.length; i < len; ++i) {
          parseParam(key, separatedParams[i]);
        }
      }
    }
    return {
      searchParams: searchParams,
      page: page,
      per_page: per_page,
      sort: sort
    }
  };
};
