import * as THREE from './lib/three.module.js';


import {RadarManager} from "./radar.js"
import {AuxLidarManager} from "./aux_lidar.js"
import {Lidar} from "./lidar.js"
import {Annotation} from "./annotation.js"
import {EgoPose} from "./ego_pose.js"
import {logger} from "./log.js"
import { euler_angle_to_rotate_matrix, euler_angle_to_rotate_matrix_3by3, matmul, matmul2 , mat} from './util.js';

function FrameInfo(data, sceneMeta, sceneName, frame){
    
    this.data = data;
    this.sceneMeta = sceneMeta;
    this.dir = "";
    this.scene = sceneName;
    this.frame = frame;
    this.pcd_ext = "";
    this.frame_index = this.sceneMeta.frames.indexOf(frame),
    this.frame_length = this.sceneMeta.frames.length;
    this.transform_matrix = this.sceneMeta.point_transform_matrix,
    this.annotation_format = this.sceneMeta.boxtype, //xyz(24 number), csr(center, scale, rotation, 9 number)

    this.get_pcd_path = function(){
            if (this.scene.substring(0,4) == 'nusc')
                return 'data_nusc/'+this.sceneMeta.lidar_path[this.frame_index];
            else
                return 'data/'+ this.scene + "/lidar/" + this.frame + this.sceneMeta.lidar_ext;
        };
    this.get_radar_path = function(name){
        if (this.scene.substring(0,4) == 'nusc')
            return 'data_nusc/'+this.sceneMeta.radar_path[this.frame_index][name];
        else
            return `data/${this.scene}/radar/${name}/${this.frame}${this.sceneMeta.radar_ext}`;
    };
    this.get_aux_lidar_path = function(name){
        return `data/${this.scene}/aux_lidar/${name}/${this.frame}${this.sceneMeta.radar_ext}`;
    }

    this.anno_to_boxes = function(text,text1){
            if (this.annotation_format == "psr")
                return text1;
            else
                return {"anns":this.python_xyz_to_psr(text)};
        };
    this.transform_point = function(m, x,y, z){
            var rx = x*m[0]+y*m[1]+z*m[2];
            var ry = x*m[3]+y*m[4]+z*m[5];
            var rz = x*m[6]+y*m[7]+z*m[8];
            return [rx, ry, rz];
        };
    
    /*
    input is coordinates of 8 vertices
    bottom-left-front, bottom-right-front, bottom-right-back, bottom-left-back
    top-left-front,    top-right-front,    top-right-back,    top-left-back

    this format is what SECOND/PointRcnn save their results.
    */
    this.python_xyz_to_psr = function(text){
            var _self = this;
            var points_array = text.split('\n').filter(function(x){return x;}).map(function(x){return x.split(' ').map(function(x){return parseFloat(x);})})
            var boxes = points_array.map(function(ps){
                for (var i=0; i<8; i++){
                    var p = _self.transform_point(_self.transform_matrix, ps[3*i+0],ps[3*i+1],ps[3*i+2]);
                    ps[i*3+0] = p[0];
                    ps[i*3+1] = p[1];
                    ps[i*3+2] = p[2];                
                }
                return ps;
            });
            
            var boxes_ann = boxes.map(this.xyz_to_psr);
    
            return boxes_ann; //, boxes];
        };

    this.xyz_to_psr = function(ann_input){
            var ann = [];
            if (ann_input.length==24)
                ann = ann_input;
            else
                for (var i = 0; i<ann_input.length; i++){
                    if ((i+1) % 4 != 0){
                        ann.push(ann_input[i]);
                    }
                }

            var pos={x:0,y:0,z:0};
            for (var i=0; i<8; i++){
                pos.x+=ann[i*3];
                pos.y+=ann[i*3+1];
                pos.z+=ann[i*3+2];
            }
            pos.x /=8;
            pos.y /=8;
            pos.z /=8;

            var scale={
                x: Math.sqrt((ann[0]-ann[3])*(ann[0]-ann[3])+(ann[1]-ann[4])*(ann[1]-ann[4])),
                y: Math.sqrt((ann[0]-ann[9])*(ann[0]-ann[9])+(ann[1]-ann[10])*(ann[1]-ann[10])),
                z: ann[14]-ann[2],
            };
            
            /*
            1. atan2(y,x), not x,y
            2. point order in xy plane
                0   1
                3   2
            */

            var angle = Math.atan2(ann[4]+ann[7]-2*pos.y, ann[3]+ann[6]-2*pos.x);

            return {
                position: pos,
                scale:scale,
                rotation:{x:0,y:0,z:angle},
            }
        };
}

function Images(sceneMeta, sceneName, frame){
    this.loaded = function(){
        for (var n in this.names){
            if (!this.loaded_flag[this.names[n]])
                return false;
        }

        return true;
    };
    let frame_index = sceneMeta.frames.indexOf(frame)
    this.names = sceneMeta.camera; //["image","left","right"],
    this.loaded_flag = {};
    this.getImageByName = function(name){
        return this.content[name];
    };

    this.content = {};
    this.on_all_loaded = null;

    this.load = function(on_all_loaded, active_name){
        this.on_all_loaded = on_all_loaded;

        var _self = this;

        if (this.names){
            this.names.forEach(function(cam){
                _self.content[cam] = new Image();
                _self.content[cam].onload= function(){ 
                    _self.loaded_flag[cam] = true;
                    _self.on_image_loaded();
                };
                _self.content[cam].onerror=function(){ 
                    _self.loaded_flag[cam] = true;
                    _self.on_image_loaded();
                };
                if (sceneName.substring(0,4) == 'nusc')
                    _self.content[cam].src = 'data_nusc/'+sceneMeta.camera_path[cam][frame_index];
                else
                    _self.content[cam].src = 'data/'+sceneName+'/camera/' + cam + '/'+ frame + sceneMeta.camera_ext;
                // console.log("image set")
            });
        }
    },

    this.on_image_loaded = function(){
        if (this.loaded()){
            this.on_all_loaded();
        }
    }
}



function World(data, sceneName, frame, coordinatesOffset, on_preload_finished){
    this.data = data;
    this.sceneMeta = this.data.getMetaBySceneName(sceneName);

    this.frameInfo = new FrameInfo(this.data, this.sceneMeta, sceneName, frame);
    this.coordinatesOffset = coordinatesOffset;
    this.Been_Modified = false;


    this.toString = function(){
        return this.frameInfo.scene + "," + this.frameInfo.frame;
    }
    //points_backup: null, //for restore from highlight
        
    this.cameras = new Images(this.sceneMeta, sceneName, frame);
    this.radars = new RadarManager(this.sceneMeta, this, this.frameInfo);
    this.lidar = new Lidar(this.sceneMeta, this, this.frameInfo);
    this.annotation = new Annotation(this.sceneMeta, this, this.frameInfo);
    this.aux_lidars = new AuxLidarManager(this.sceneMeta, this, this.frameInfo);
    this.egoPose = new EgoPose(this.sceneMeta, this, this.FrameInfo);

    // todo: state of world could be put in  a variable
    // but still need mulitple flags.

    this.points_loaded = false,


    
    this.preloaded=function(){
        return this.lidar.preloaded && 
               this.annotation.preloaded && 
               //this.cameras.loaded() &&
               this.aux_lidars.preloaded() && 
               this.radars.preloaded()&&
               this.egoPose.preloaded;
    };

    this.create_time = 0;
    this.finish_time = 0;

    this.on_subitem_preload_finished = function(on_preload_finished){
        if (this.preloaded()){
            if (on_preload_finished)
                on_preload_finished(this);
            if (this.active)
                this.go();
        }
    };


    this.calcTransformMatrix = function()
    {
        if (this.egoPose.egoPose){
                let thisPose = this.egoPose.egoPose;
                let refPose = this.data.getRefEgoPose(this.frameInfo.scene, thisPose);
                let thisRot = null;
                if(this.frameInfo.scene.substring(0,4)=="nusc")
                    thisRot = {
                        x: thisPose.roll,
                        y: thisPose.pitch,
                        z: thisPose.azimuth
                    };
                else
                    thisRot = {
                        x: thisPose.pitch * Math.PI/180.0,
                        y: thisPose.roll * Math.PI/180.0,
                        z: - thisPose.azimuth * Math.PI/180.0
                    };
    
                let posDelta = {
                    x: thisPose.x - refPose.x,
                    y: thisPose.y - refPose.y,
                    z: thisPose.z - refPose.z,
                };
    

                let trans_ego_utm = null
                let trans_lidar_ego = null
                if(this.frameInfo.scene.substring(0,4)=="nusc"){
                    trans_lidar_ego = new THREE.Matrix4().fromArray(this.sceneMeta.lidar2ego[this.frameInfo.frame_index])
                    trans_ego_utm = new THREE.Matrix4().fromArray(this.sceneMeta.ego2global[this.frameInfo.frame_index]);
                }

                else{
                    trans_lidar_ego = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0,0,Math.PI, "ZYX"))
                        .setPosition(0, 0, 0.4);
                    trans_ego_utm = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(thisRot.x, thisRot.y, thisRot.z, "ZXY"))
                        .setPosition(posDelta.x, posDelta.y, posDelta.z);
                }

                
                let trans_utm_scene = new THREE.Matrix4().identity().setPosition(this.coordinatesOffset[0], this.coordinatesOffset[1], this.coordinatesOffset[2]);
                this.trans_lidar_utm = new THREE.Matrix4().multiplyMatrices(trans_ego_utm, trans_lidar_ego);

                if (this.data.cfg.coordinateSystem == "utm")
                    this.trans_lidar_scene = new THREE.Matrix4().multiplyMatrices(trans_utm_scene, this.trans_lidar_utm);
                else
                    this.trans_lidar_scene = trans_utm_scene;  //only offset.
                this.trans_utm_lidar = new THREE.Matrix4().copy(this.trans_lidar_utm).invert();
                this.trans_scene_lidar = new THREE.Matrix4().copy(this.trans_lidar_scene).invert();
            }
        else
        {
            let trans_utm_scene = new THREE.Matrix4().identity().setPosition(this.coordinatesOffset[0], this.coordinatesOffset[1], this.coordinatesOffset[2]);
            let id = new THREE.Matrix4().identity();
            this.trans_lidar_utm = id;
            this.trans_lidar_scene = trans_utm_scene;
            this.trans_utm_lidar = new THREE.Matrix4().copy(this.trans_lidar_utm).invert();
            this.trans_scene_lidar = new THREE.Matrix4().copy(this.trans_lidar_scene).invert();
        }


            
            this.webglGroup.matrix.copy(this.trans_lidar_scene);
            this.webglGroup.matrixAutoUpdate = false;
    };

    // global scene 
    this.scenePosToLidar = function(pos)
    {
        let tp = new THREE.Vector4(pos.x, pos.y, pos.z, 1).applyMatrix4(this.trans_scene_lidar);

        return tp;        
    }

    // global scene
    this.lidarPosToScene = function(pos)
    {
        let tp = new THREE.Vector3(pos.x, pos.y, pos.z).applyMatrix4(this.trans_lidar_scene);

        return tp;        
    }

     // global scene
     this.lidarPosToUtm = function(pos)
     {
         if(!pos){
             window.editor.infoBox.show("Error!","Calculate utm coordinate error!")
             return;
         }
         let tp = new THREE.Vector3(pos.x, pos.y, pos.z).applyMatrix4(this.trans_lidar_utm);
         return tp;        
     }
     this.UtmPosTolidar = function(pos)
     {
         let tp = new THREE.Vector3(pos.x, pos.y, pos.z).applyMatrix4(this.trans_utm_lidar);
         return tp;
     }

     

    this.sceneRotToLidar = function(rotEuler)
    {
        if (!rotEuler.isEuler)
        {
            rotEuler = new THREE.Euler(rotEuler.x, rotEuler.y, rotEuler.z, "XYZ");
        }

        let rotG = new THREE.Quaternion().setFromEuler(rotEuler);
        let GlobalToLocalRot = new THREE.Quaternion().setFromRotationMatrix(this.trans_scene_lidar);

        let retQ = rotG.multiply(GlobalToLocalRot);

        let retEuler = new THREE.Euler().setFromQuaternion(retQ, rotEuler.order);

        return retEuler;
    }

    this.lidarRotToScene = function(rotEuler)
    {
        if (!rotEuler.isEuler)
        {
            rotEuler = new THREE.Euler(rotEuler.x, rotEuler.y, rotEuler.z, "XYZ");
        }

        let rotL = new THREE.Quaternion().setFromEuler(rotEuler);
        let localToGlobalRot = new THREE.Quaternion().setFromRotationMatrix(this.trans_lidar_scene)

        let retQ = rotL.multiply(localToGlobalRot);

        let retEuler = new THREE.Euler().setFromQuaternion(retQ, rotEuler.order);

        return retEuler;
    }

    this.lidarRotToUtm = function(rotEuler)
    {
        if (!rotEuler.isEuler)
        {
            rotEuler = new THREE.Euler(rotEuler.x, rotEuler.y, rotEuler.z, "XYZ");
        }

        let rotL = new THREE.Quaternion().setFromEuler(rotEuler);
        let localToGlobalRot = new THREE.Quaternion().setFromRotationMatrix(this.trans_lidar_utm)

        let retQ = rotL.multiply(localToGlobalRot);

        let retEuler = new THREE.Euler().setFromQuaternion(retQ, rotEuler.order);

        return retEuler;
    }

    this.utmRotToLidar = function(rotEuler)
    {
        if (!rotEuler.isEuler)
        {
            rotEuler = new THREE.Euler(rotEuler.x, rotEuler.y, rotEuler.z, "XYZ");
        }

        let rot = new THREE.Quaternion().setFromEuler(rotEuler);
        let trans = new THREE.Quaternion().setFromRotationMatrix(this.trans_utm_lidar);

        let retQ = rot.multiply(trans);

        let retEuler = new THREE.Euler().setFromQuaternion(retQ, rotEuler.order);

        return retEuler;
    }


    this.preload=function(on_preload_finished){
        this.create_time = new Date().getTime();
        // console.log(this.create_time, sceneName, frame, "start");

        this.webglGroup = new THREE.Group();
        this.webglGroup.name = "world";
        
        
        let _preload_cb = ()=>this.on_subitem_preload_finished(on_preload_finished);

        this.egoPose.preload(_preload_cb);
        this.calcTransformMatrix();
        this.lidar.preload(_preload_cb);
        this.annotation.preload(_preload_cb);
        this.radars.preload(_preload_cb);
        this.cameras.load(_preload_cb, this.data.active_camera_name);
        this.aux_lidars.preload(_preload_cb);
    };

    this.scene = null,
    this.destroy_old_world = null, //todo, this can be a boolean
    this.on_finished = null,
    this.activate=function(scene, destroy_old_world, on_finished){
        this.scene = scene;
        this.active = true;
        this.destroy_old_world = destroy_old_world;
        this.on_finished = on_finished;
        if (this.preloaded()){
            this.go();
        }
    };

    this.active = false,
    this.everythingDone = false;
    
    this.go=function(){

        if (this.everythingDone){

            if (this.on_finished){
                this.on_finished();
            }
            return;
        }

        if (this.preloaded()){

            //this.points.material.size = data.cfg.point_size;
            
            if (this.destroy_old_world){
                this.destroy_old_world();
            }

            if (this.destroyed){
                console.log("go after destroyed.");
                this.unload();
                return;
            }

            this.scene.add(this.webglGroup);
            
            this.lidar.go(this.scene);
            this.annotation.go(this.scene);
            this.radars.go(this.scene);            
            this.aux_lidars.go(this.scene);


            // render is called in on_finished() callback
            if (this.on_finished){
                this.on_finished();
            }
            this.everythingDone = true;
        }
    };


    this.add_line=function(start, end, color){
        var line = this.new_line(start, end, color);
        this.scene.add(line);
    };



    this.new_line=function(start, end, color){

        var vertex = start.concat(end);
        this.world.data.dbg.alloc();
        var line = new THREE.BufferGeometry();
        line.addAttribute( 'position', new THREE.Float32BufferAttribute(vertex, 3 ) );
        
        if (!color){
            color = 0x00ff00;
        }
   
        var material = new THREE.LineBasicMaterial( { color: color, linewidth: 1, opacity: this.data.cfg.box_opacity, transparent: true } );
        return new THREE.LineSegments( line, material );                
    };



    this.destroyed = false;

    // todo, Image resource to be released?

    this.unload = function(){
        if (this.everythingDone){
            //unload all from scene, but don't destroy elements
            this.lidar.unload();
            this.radars.unload();
            this.aux_lidars.unload();
            this.annotation.unload();

            this.scene.remove(this.webglGroup);
            
            this.active = false;
            this.everythingDone = false;
        }
    };
    this.deleteAll = function(){
        var _self= this;

        // logger.log(`delete world ${this.frameInfo.scene},${this.frameInfo.frame}`);

        if (this.everythingDone)
            this.unload();

        // todo, check if all objects are removed from webgl scene.
        if (this.destroyed)
            console.log("destroy destroyed world!");

        this.lidar.deleteAll();
        this.radars.deleteAll();
        this.aux_lidars.deleteAll();
        this.annotation.deleteAll();

        this.destroyed = true;
        // console.log(this.frameInfo.scene, this.frameInfo.frame, "destroyed");
        // remove me from buffer
    };
    this.preload(on_preload_finished);  
}

export {World};

