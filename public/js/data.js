

import {World} from "./world.js";
import {Debug} from "./debug.js";
import {logger} from "./log.js"
import {saveWorldList} from "./save.js";

class Data
{

    constructor(cfg){
        this.cfg = cfg;
    }
    // multiple world support
    // place world by a offset so they don't overlap
    dbg = new Debug();

    worldGap=1000.0;
    worldList=[];
    MaxWorldNumber=80;
    createWorldIndex = 0; // this index shall not repeat, so it increases permanently

    async getWorld(sceneName, frame, on_preload_finished){
        // find in list

        if (!this.meta[sceneName])
            await this.readSceneMetaData(sceneName)

        if (!this.meta[sceneName])
        {
            logger.log("load scene failed", sceneName);
            return null; 
        }

        let world = this.worldList.find((w)=>{
            return w.frameInfo.scene == sceneName && w.frameInfo.frame == frame;
        })
        if (world) // found!
            return world;
                
        world = this._createWorld(sceneName, frame, on_preload_finished);

        return world;
    };

    _createWorld(sceneName, frame, on_preload_finished){

        let [x,y,z] = this.allocateOffset();
        // console.log("create world",x,y,z);
        let world = new World(this, sceneName, frame, [this.worldGap*x, this.worldGap*y, this.worldGap*z], on_preload_finished);        
        world.offsetIndex = [x,y,z];
        this.createWorldIndex++;
        this.worldList.push(world);
        
        return world;

    };

    findWorld(sceneName, frameIndex){
        let world = this.worldList.find((w)=>{
            return w.frameInfo.scene == sceneName && w.frameInfo.frame_index == frameIndex;
        })
        if (world) // found!
            return world;
        else
            return null;
    };

    offsetList = [[0,0,0]];
    lastSeedOffset = [0,0,0];
    offsetsAliveCount  = 0;
    allocateOffset()
    {
        // we need to make sure the first frame loaded in a scene 
        // got to locate in [0,0,0]
        if (this.offsetsAliveCount == 0)
        {
            //reset offsets.
            this.offsetList = [[0,0,0]];
            this.lastSeedOffset = [0,0,0];
        }
        if (this.offsetList.length == 0)
        {
            let [x,y,z] = this.lastSeedOffset;

            if (x == y)
            {  
                x = x+1;
                y = 0;
            }
            else
                y = y+1;
            this.lastSeedOffset = [x, y, 0];
            this.offsetList.push([x,y,0]);
            if (x != 0)  this.offsetList.push([-x,y,0]);
            if (y != 0)  this.offsetList.push([x,-y,0]);
            if (x * y != 0)  this.offsetList.push([-x,-y,0]);

            if (x != y) {
                this.offsetList.push([y,x,0]);
                if (y != 0)  this.offsetList.push([-y,x,0]);
                if (x != 0)  this.offsetList.push([y,-x,0]);
                if (x * y != 0)  this.offsetList.push([-y,-x,0]);
            }
        }

        let ret =  this.offsetList.pop();
        this.offsetsAliveCount++;

        return ret;
    };

    returnOffset(offset)
    {
        this.offsetList.push(offset);
        this.offsetsAliveCount--;
    };

    deleteDistantWorlds(world){
        let currentWorldIndex = world.frameInfo.frame_index;

        let disposable = (w)=>{
            let distant = Math.abs(w.frameInfo.frame_index - currentWorldIndex)>this.MaxWorldNumber;
            let active  = w.everythingDone;
            // if (w.annotation.modified)
            //     console.log("deleting world not saved. stop.");
            // return distant && !active && !w.annotation.modified;
            return distant && !active
        }

        let distantWorldList = this.worldList.filter(w=>disposable(w));

        distantWorldList.forEach(w=>{
            this.returnOffset(w.offsetIndex);
            w.deleteAll();
        });

        
        this.worldList = this.worldList.filter(w=>!disposable(w));

    };

    deleteOtherWorldsExcept=function(keepScene){
        // release resources if scene changed
        this.worldList.forEach(w=>{
            if (w.frameInfo.scene != keepScene){
                this.returnOffset(w.offsetIndex);
                w.deleteAll();

                this.removeRefEgoPoseOfScene(w.frameInfo.scene);
            }
        })
        this.worldList = this.worldList.filter(w=>w.frameInfo.scene==keepScene);
    };
    

    refEgoPose={};
    getRefEgoPose(sceneName, currentPose)
    {
        if (this.refEgoPose[sceneName]){
            return this.refEgoPose[sceneName];
        }
        else{
            this.refEgoPose[sceneName] = currentPose;
            return currentPose;
        }
    }

    removeRefEgoPoseOfScene(sceneName)
    {
        if (this.refEgoPose[sceneName])
            delete this.refEgoPose[sceneName];
    }

    forcePreloadScene(sceneName, currentWorld){
        //this.deleteOtherWorldsExcept(sceneName);
        let meta = currentWorld.sceneMeta;

        let currentWorldIndex = currentWorld.frameInfo.frame_index;
        let startIndex = Math.max(0, currentWorldIndex - this.MaxWorldNumber/2);
        let endIndex = Math.min(meta.frames.length, startIndex + this.MaxWorldNumber);

        this._doPreload(sceneName, startIndex, endIndex);       
        
        // logger.log(`${endIndex - startIndex} frames created`);
    }

    preloadScene(sceneName, currentWorld,donnotdelete){

        // clean other scenes.
        if(!donnotdelete){
            this.deleteOtherWorldsExcept(sceneName);
            this.deleteDistantWorlds(currentWorld);
        }
        if (!this.cfg.enablePreload)
            return;
        
        this.forcePreloadScene(sceneName, currentWorld);
        
    };
    _doPreload(sceneName, startIndex, endIndex)
    {
        let meta = this.getMetaBySceneName(sceneName);
        let numLoaded = 0;
        let _need_create = (frame)=>{
            let world = this.worldList.find((w)=>{
                return w.frameInfo.scene == sceneName && w.frameInfo.frame == frame;
            })
            return !world;
        }
        let pendingFrames = meta.frames.slice(startIndex, endIndex).filter(_need_create);
        let _self = this;
        let _do_create = (frame)=>{
            this._createWorld(sceneName, frame,()=>{
                numLoaded++;
                if(numLoaded==pendingFrames.length){
                    _self.worldList.forEach(w=>{
                        w.annotation.boxes.forEach(box=>{
                                window.editor.change_box_velocity(box);
                                if(box.world.from=="tmp" && window.editor.tracker)
                                    window.editor.tracker.update_box(box.world.frameInfo.frame,box,'modify');
                            });
                        }
                    );
                    if(this.worldList.length!=this.world.frameInfo.sceneMeta.frames.length)
                        console.log("Preload Error")
                    else{
                        // saveWorldList(this.worldList,true,false);
                        console.log("Preloaded All frames in "+sceneName);
                    }
                }

            });
        };
        pendingFrames.forEach(_do_create);

    }


    onAnnotationUpdatedByOthers(scene, frames){
        frames.forEach(f=>{
            let world = this.worldList.find(w=>(w.frameInfo.scene==scene && w.frameInfo.frame==f));
            if (world)
                world.annotation.reloadAnnotation();
        })
    };

    webglScene = null;
    set_webglScene=function(scene, mainScene){
            this.webglScene = scene;
            this.webglMainScene = mainScene;
        };

    scale_point_size(v){
        this.cfg.point_size *= v;


        this.worldList.forEach(w=>{
            w.lidar.set_point_size(this.cfg.point_size);
        });
    };

    scale_point_brightness(v){
        this.cfg.point_brightness *= v;



        this.worldList.forEach(w=>{
            w.lidar.recolor_all_points();
        })
    };

    set_box_opacity(opacity){
        this.cfg.box_opacity = opacity;

        this.worldList.forEach(w=>{
            w.annotation.set_box_opacity(this.cfg.box_opacity);
        });
    };

    toggle_background(){
        this.cfg.show_background = !this.cfg.show_background;

        if (this.cfg.show_background){
            this.world.lidar.cancel_highlight();
        }
        else{
            this.world.lidar.hide_background();
        }
    };

    set_obj_color_scheme(scheme){

        
        pointsGlobalConfig.color_obj = scheme;

        // toto: move to world
        this.worldList.forEach(w=>{
            if (pointsGlobalConfig.color_obj == "no")
            {
                w.lidar.color_points();
            }
            else
            {
                w.lidar.color_objects();
            }
            
            w.lidar.update_points_color();

            w.annotation.color_boxes();
        })
    };


    world=null;


    activate_world= function(world, on_finished, dontDestroyOldWorld){
        document.querySelector("#frame-input").value = (world.frameInfo.frame_index+1).toString();
        if (dontDestroyOldWorld)
            world.activate(this.webglScene, null, on_finished);            
        else{
            var old_world = this.world;   // current world, should we get current world later?
            this.world = world;  // swich when everything is ready. otherwise data.world is half-baked, causing mysterious problems.

            world.activate(this.webglMainScene, 
                function(){
                    if (old_world)
                        old_world.unload();
                },
                on_finished);
        }
    };


    meta = {};  //meta data

    getMetaBySceneName = (sceneName)=>{
        return this.meta[sceneName];
    };


    get_current_world_scene_meta(){
        return this.getMetaBySceneName(this.world.frameInfo.scene);
    };


    readSceneMetaData(sceneName,not_async)
    {
        let self =this;
        return new Promise(function(resolve, reject){
            let xhr = new XMLHttpRequest();
            
            xhr.onreadystatechange = function () {
                if (this.readyState != 4) 
                    return;
            
                if (this.status == 200) {
                    let sceneMeta = JSON.parse(this.responseText);
                    self.meta[sceneName] = sceneMeta;
                    resolve(sceneMeta);
                }

            };
            
            xhr.open('GET', `/scenemeta?scene=${sceneName}`, true);
            xhr.send();
        });
    }
};


export {Data};

