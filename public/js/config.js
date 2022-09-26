
class Config{

    //dataCfg = {
    // disableLabels = true;
    mode = "real";//["normal","test","real"]
    testNFrame = 100;
    enablePreload = true;
    color_points = "mono";
    enableRadar = true;
    enableAuxLidar = false;
    enableDynamicGroundLevel = true;

    coordinateSystem = 'lidar';

    point_size = 1;
    point_brightness = 0.6;
    box_opacity = 1;
    show_background = true;
    color_obj = "category";
    theme = "dark";

    enableFilterPoints = false;
    filterPointsZ = 2.0;

    batchModeInstNumber = 20;
    batchModeSubviewSize = {width: 130, height: 450};


    // edit on one box, apply to all selected boxes.
    linkEditorsInBatchMode = false;

    // only rotate z in 'auto/interpolate' algs
    enableAutoRotateXY = false;
    autoSave = false;

    autoUpdateInterpolatedBoxes = true;

    hideId = false;
    hideradar = false;
    hideCategory = false;

    moveStep = 0.01;  // ratio, percentage
    rotateStep = Math.PI/360;
    
    ignoreDistantObject = true;

    //Tracking algo Param
    onlyuseOfflineTrack = true;
    thresh = 0.2;
    detection_file = "/data/SUSTech_data_det_infos.json"
    tracking_file = "/data/SUSTech_data_track_infos.json"
    num_scene = 10;
    
    ///editorCfg

    //disableSceneSelector = true;
    //disableFrameSelector = true;
    //disableCameraSelector = true;
    //disableFastToolbox= true;
    //disableMainView= true;
    //disableMainImageContext = true;
    //disableGrid = true;
    //disableAxis = true;
    //disableMainViewKeyDown = true;
    projectRadarToImage = true;
    projectLidarToImage = true;

    constructor()
    {
        
    }

    readItem(name, defaultValue, castFunc){
        let ret = window.localStorage.getItem(name);
        if (ret)
        {
            if (castFunc)
                return castFunc(ret);
            else
                return ret;
        }
        else
            return defaultValue;
    }

    setItem(name, value)
    {
        this[name] = value;
        if (typeof value == 'object')
            value = JSON. stringify(value);
        window.localStorage.setItem(name, value);
    }

    toBool(v)
    {
        return v=="true";
    }

    saveItems = [
        ["theme", null],
        ["enableRadar", this.toBool],
        ["enablePreload", this.toBool],
        ["enableAuxLidar", this.toBool],
        ["enableFilterPoints", this.toBool],
        ["filterPointsZ", parseFloat],
        ["color_points", null],
        ["batchModeInstNumber", parseInt],
        ["batchModeSubviewSize", JSON.parse],
        ["enableAutoRotateXY", this.toBool],
        ["autoUpdateInterpolatedBoxes", this.toBool],
    ];

    load()
    {
        this.saveItems.forEach(item=>{
            let key = item[0];
            let castFunc = item[1];
            this[key] = this.readItem(key, this[key], castFunc);
        })
    }
};

export {Config};