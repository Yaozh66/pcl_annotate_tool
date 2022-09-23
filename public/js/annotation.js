

import * as THREE from './lib/three.module.js';
import {globalObjectCategory} from './obj_cfg.js';
import {saveWorldList} from "./save.js"
import { intersect } from './util.js';


function Annotation(sceneMeta, world, frameInfo){
    this.world = world;
    this.data = this.world.data;
    //this.coordinatesOffset = this.world.coordinatesOffset;
    this.boxes_load_time = 0;
    this.frameInfo = frameInfo;


    this.modified = false;
    this.saved = false;
    this.setModified = function(){
        this.modified=true;
        if (pointsGlobalConfig.autoSave)
            saveWorldList([this.world]);
    };
    this.resetModified = function(){this.modified=false;};


    this.sort_boxes = function(){
        this.boxes = this.boxes.sort(function(x,y){
            return x.position.y - y.position.y;
        });
    };
    this.findBoxByTrackId = function(id){
        if (this.boxes){
            let box = this.boxes.find(function(x){
                return x.obj_track_id == id;
            }) ;
            return box;
        }
        return null;
    };



    this.findIntersectedBoxes = function(box){
        return this.boxes.filter(b=>b!=box).filter(b=>intersect(box, b));
    };

    this.preload = function(on_preload_finished){
        this.on_preload_finished = on_preload_finished;
        this.load_annotation((boxes)=>this.proc_annotation(boxes,true));
    };

    

    this.go_cmd_received = false;
    this.webglScene = null;
    this.on_go_finished = null;
    this.go = function(webglScene, on_go_finished){
        this.webglScene = webglScene;
        if (this.preloaded){
            //this.boxes.forEach(b=>this.webglScene.add(b));
            if (this.data.cfg.color_obj != "no"){
                this.color_boxes();
            }
            if (on_go_finished)
                on_go_finished();
        } else {
            this.go_cmd_received = true;
            this.on_go_finished = on_go_finished;
        }
    };


    // internal funcs below
    this._afterPreload = function(){
        this.preloaded = true;
        // console.log("annotation preloaded");

        if (this.on_preload_finished){
            this.on_preload_finished();
        }                
        if (this.go_cmd_received){
            this.go(this.webglScene, this.on_go_finished);
        }
    };


    this.unload = function(){
        if (this.boxes){
            this.boxes.forEach((b)=>{
                //this.webglGroup.remove(b);

                if (b.boxEditor)
                    b.boxEditor.detach();
            });
        }
    };

    this.deleteAll = function(){
        this.remove_all_boxes();
    };
    this.boxToAnn = function(box){
        let ann = {
            psr: {
                position:{
                    x: box.position.x,
                    y: box.position.y,
                    z: box.position.z,
                },
                scale:{
                    x: box.scale.x,
                    y: box.scale.y,
                    z: box.scale.z,                    
                },
                rotation:{
                    x:box.rotation.x,
                    y:box.rotation.y,
                    z:box.rotation.z,
                },
            },
            globalpsr:box.globalpsr,
            obj_type: box.obj_type,
            obj_id: box.obj_track_id,
            obj_attr: box.obj_attr,
            //vertices: vertices,
        };
        return ann;
    };

    this.toBoxAnnotations = function(){
        let anns = this.boxes.map((b)=>{
            //var vertices = psr_to_xyz(b.position, b.scale, b.rotation);
            let ann = this.boxToAnn(b);
            ann.score = 1.0;
            if (b.annotator)
                ann.annotator = b.annotator;

            if (b.follows)
                ann.follows = b.follows;

            if(b.velocity)
                ann.velocity = b.velocity;
            if(b.timestamp)
                ann.timestamp = b.timestamp;
            return ann;
        });

        anns.sort((a,b)=>a.obj_id- b.obj_id);

        return anns;
    };

    // to real-world position (no offset)
    this.ann_to_utm_vector = function(box) {
        let posG = this.world.lidarPosToUtm(box.position);
        let rotG = this.world.lidarRotToUtm(box.rotation);
        return [
            posG.x, posG.y, posG.z,
            rotG.x, rotG.y, rotG.z,
            box.scale.x, box.scale.y, box.scale.z,
        ];
    };

    // real-world position to ann
    this.utm_vector_to_ann = function(v)
    {
        if(!v)
            return false;
        let posG = new THREE.Vector3(v[0], v[1], v[2]);
        let rotG = new THREE.Euler(v[3],v[4],v[5]);
        let rotL = this.world.utmRotToLidar(rotG);
        let posL = this.world.UtmPosTolidar(posG);
        return {
            position: {x: posL.x, y: posL.y, z: posL.z},
            rotation: {x: rotL.x, y: rotL.y, z: rotL.z},
            scale:    {x: v[6],   y: v[7],   z: v[8]}
        };

    };

    // to real-world position (no offset)
    this.ann_to_vector_global = function(box) {
        let posG = this.world.lidarPosToScene(box.position);
        let rotG = this.world.lidarRotToScene(box.rotation);

        return [
            posG.x - this.world.coordinatesOffset[0], posG.y-this.world.coordinatesOffset[1], posG.z-this.world.coordinatesOffset[2], 
            rotG.x, rotG.y, rotG.z, 
            box.scale.x, box.scale.y, box.scale.z, 
        ];

    };

    // real-world position to ann
    this.vector_global_to_ann = function(v)
    {
        if(!v)
            return false;
        let posG = new THREE.Vector3(v[0]+this.world.coordinatesOffset[0],
                                     v[1]+this.world.coordinatesOffset[1],
                                     v[2]+this.world.coordinatesOffset[2]);
        let rotG = new THREE.Euler(v[3],v[4],v[5]);

        let rotL = this.world.sceneRotToLidar(rotG);
        let posL = this.world.scenePosToLidar(posG);

        return {
            position: {x: posL.x, y: posL.y, z: posL.z},
            rotation: {x: rotL.x, y: rotL.y, z: rotL.z},
            scale:    {x: v[6],   y: v[7],   z: v[8]}
        };

    };

    this.remove_all_boxes = function(){
        if (this.boxes){
            this.boxes.forEach((b)=>{
                this.webglGroup.remove(b);
                this.world.data.dbg.free();
                b.geometry.dispose();
                b.material.dispose();
                b.world = null;
                b.boxEditor = null;
            });

            this.boxes = [];
        }
        else{
            console.error("destroy empty world!")
        }
    };

    this.new_bbox_cube=function(color){

        var h = 0.5;
        
        var body = [
            //top
            -h,h,h,  h,h,h,
            h,h,h,   h,-h,h,
            h,-h,h,  -h,-h,h,
            -h,-h,h, -h, h, h, 

            //botom
            -h,h,-h,  h,h,-h,
            h,h,-h,   h,-h,-h,
            h,-h,-h,  -h,-h,-h,
            -h,-h,-h, -h, h, -h, 

            // vertical lines
            -h,h,h, -h,h,-h,
            h,h,h,   h,h,-h,
            h,-h,h,  h,-h,-h,
            -h,-h,h, -h,-h,-h,

            //direction
            h,   0,  h,  1.5*h, 0, h,
            //h/2, -h, h+0.1,  h, 0, h+0.1,
            //h/2,  h, h+0.1,  h, 0, h+0.1,

            //side direction
            // h, h/2, h,  h, h, 0,
            // h, h/2, -h,  h, h, 0,
            // h, 0, 0,  h, h, 0,
            
        ];
        

        this.world.data.dbg.alloc();

        var bbox = new THREE.BufferGeometry();
        bbox.setAttribute( 'position', new THREE.Float32BufferAttribute(body, 3 ) );
        
        if (!color){
            color = 0x00ff00;
        }

        /*
        https://threejs.org/docs/index.html#api/en/materials/LineBasicMaterial
        linewidth is 1, regardless of set value.
        */

        
        var material = new THREE.LineBasicMaterial( { color: color, linewidth: 1, opacity: this.data.cfg.box_opacity, transparent: true } );
        var box = new THREE.LineSegments( bbox, material );
        
        box.scale.x=1.8;
        box.scale.y=4.5;
        box.scale.z=1.5;
        box.name="bbox";
        box.obj_type="car";                

        return box;
    };

    this.createCuboid = function(pos, scale, rotation, obj_type, track_id, obj_attr,dontcalc_vel){
        let mesh = this.new_bbox_cube(parseInt("0x"+globalObjectCategory.get_obj_cfg_by_type(obj_type,document.querySelector("#scene-input").value.substring(0,4) == 'nusc')
            .color.slice(1)));
        mesh.position.x = pos.x;
        mesh.position.y = pos.y;
        mesh.position.z = pos.z;

        let globalpos = this.world.lidarPosToUtm(pos);
        let globalrot = this.world.lidarRotToUtm(rotation);
        mesh.globalpsr = {position:{x:globalpos.x,y:globalpos.y,z:globalpos.z},
            rotation:{x:globalrot.x,y:globalrot.y,z:globalrot.z}};


        mesh.scale.x = scale.x;
        mesh.scale.y = scale.y;
        mesh.scale.z = scale.z;

        mesh.rotation.x = rotation.x;
        mesh.rotation.y = rotation.y;
        mesh.rotation.z = rotation.z;

        mesh.obj_track_id = parseInt(track_id);  //tracking id
        mesh.obj_type = obj_type;
        mesh.obj_attr = obj_attr;
        mesh.obj_local_id =  this.get_new_box_local_id();
        mesh.timestamp = this.world.sceneMeta.timestamp[this.world.frameInfo.frame_index];
        mesh.world = this.world;
        if(!dontcalc_vel){
            window.editor.change_box_velocity(mesh);
            window.editor.tracker.update_box(this.world.frameInfo.frame,mesh,"modify");
        }
        return mesh;
    };
    /*
     pos:  offset position, after transformed
    */

    this.add_box=function(pos, scale, rotation, obj_type, track_id, obj_attr){
        let mesh = this.createCuboid(pos, scale, rotation, obj_type, track_id, obj_attr)

        this.boxes.push(mesh);
        this.sort_boxes();

        this.webglGroup.add(mesh);

        return mesh;
    };

    this.add_box_by_det = function(det){
        return this.add_box(det.psr.location,det.psr.scale,det.psr.rotation,det.obj_type,det.obj_id)
    }

    this.load_box = function(box){
        
        this.webglGroup.add(box);
    };

    this.unload_box = function(box){
        
        this.webglGroup.remove(box);
    };

    this.remove_box=function(box){
        this.world.data.dbg.free();
        box.geometry.dispose();
        box.material.dispose();
        //selected_box.dispose();
        this.boxes = this.boxes.filter(function(x){return x !=box;});
    };

    this.set_box_opacity=function(box_opacity){
        this.boxes.forEach(function(x){
            x.material.opacity = box_opacity;
        });
    };

    this.translate_box_position=function(pos, theta, axis, delta){
        switch (axis){
            case 'x':
                pos.x += delta*Math.cos(theta);
                pos.y += delta*Math.sin(theta);
                break;
            case 'y':
                pos.x += delta*Math.cos(Math.PI/2 + theta);
                pos.y += delta*Math.sin(Math.PI/2 + theta);  
                break;
            case 'z':
                pos.z += delta;
                break;
    
        }
    };

    this.find_boxes_inside_rect = function(x,y,w,h, camera){
        
        let selected_boxes_by_rect = [];

        if (!this.boxes)
            return selected_boxes_by_rect;

        
        var p = new THREE.Vector3();

        for (var i=0; i< this.boxes.length; i++){
            let box_center = this.boxes[i].position;

            let pw = this.world.lidarPosToScene(box_center);
            p.set(pw.x, pw.y, pw.z);
            p.project(camera);
            p.x = p.x/p.z;
            p.y = p.y/p.z;
            //console.log(p);
            if ((p.x > x) && (p.x < x+w) && (p.y>y) && (p.y<y+h)){
                selected_boxes_by_rect.push(this.boxes[i]);
            }
        }

        // console.log("select boxes", selected_boxes_by_rect.length);
        return selected_boxes_by_rect;
    },


    this.proc_annotation = function(boxes,dontcalc_vel){
        this.boxes = this.createBoxes(boxes,dontcalc_vel);  //create in future world

        this.webglGroup = new THREE.Group();
        this.webglGroup.name = "annotations";
        this.boxes.forEach(b=>this.webglGroup.add(b));

        this.world.webglGroup.add(this.webglGroup);

        this.boxes_load_time = new Date().getTime();
        // console.log(this.boxes_load_time, this.frameInfo.scene, this.frameInfo.frame, "loaded boxes ", this.boxes_load_time - this.create_time, "ms");

        this.sort_boxes();

        this._afterPreload();
    };

    this.load_annotation=function(on_load){
        if (this.data.cfg.disableLabels)
            on_load([]);
        else if(this.data.cfg.mode == "real" && this.data.cfg.useOfflineTrack){
            let xhr = new XMLHttpRequest();
            let _self = this;
            xhr.onreadystatechange = function () {
                if (this.readyState !== 4)
                    return;
                if (this.status == 200){
                    let text = JSON.parse(this.responseText);
                    let ann = _self.frameInfo.anno_to_boxes(this.responseText,text);
                    on_load(ann[_self.frameInfo.frame]);
                    _self.world.from = "track";

                }
            };
            xhr.open('GET', this.data.cfg.tracking_file, true);
            xhr.send();
        }
        else{
            var xhr = new XMLHttpRequest();
            // we defined the xhr
            var _self = this;
            xhr.onreadystatechange = function () {
                if (this.readyState != 4) return;
            
                if (this.status == 200) {
                    let text = JSON.parse(this.responseText);
                    let ann = _self.frameInfo.anno_to_boxes(this.responseText,text);
                    if(_self.data.cfg.mode == "test" && _self.frameInfo.frame_index%_self.data.cfg.testNFrame !=0){
                        ann.anns=[];
                        ann.has_file = false;
                    }
                    on_load(ann.anns);
                    _self.world.has_file = ann.has_file;
                    _self.world.from = ann.from;

                }
                // end of state change: it can be after some time (async)
            };
            if (this.frameInfo.scene.substring(0,4) == 'nusc')
                xhr.open('GET', "/load_annotation"+"?scene="+this.frameInfo.scene+"&frame="+this.frameInfo.frame_index.toString()+"&mode="+this.data.cfg.mode, true);
            else
                xhr.open('GET', "/load_annotation"+"?scene="+this.frameInfo.scene+"&frame="+this.frameInfo.frame+"&mode="+this.data.cfg.mode, true);
            xhr.send();
        }
    };

    this.reloadAnnotation=function(done){
        this.load_annotation(ann=>{
            this.reapplyAnnotation(ann, done);
        });
    };

    
    this.reapplyAnnotation = function(boxes, done,not_delete,only_delete_id){
            // these boxes haven't attached a world
            //boxes = this.transformBoxesByOffset(boxes);
            // mark all old boxes
            if(!not_delete)
                this.boxes.forEach(b=>{b.delete=true;});

            let pendingBoxList=[];
            boxes.forEach(nb=>{  // nb is annotation format, not a true box
                let old_box = this.boxes.find(function(x){
                    return x.obj_track_id == nb.obj_id && x.obj_track_id != "" && nb.obj_id != "" && x.obj_type == nb.obj_type;
                });
                if (old_box){
                    // found
                    // update psr
                    delete old_box.delete;  // unmark delete flag
                    old_box.position.set(nb.psr.position.x, nb.psr.position.y, nb.psr.position.z);
                    old_box.scale.set(nb.psr.scale.x, nb.psr.scale.y, nb.psr.scale.z);
                    old_box.rotation.set(nb.psr.rotation.x, nb.psr.rotation.y, nb.psr.rotation.z); 
                    old_box.obj_attr = nb.obj_attr;
                    old_box.annotator = nb.annotator;
                    old_box.changed=false; // clear changed flag.
                    let globalpos = this.world.lidarPosToUtm(old_box.position);
                    let globalrot = this.world.lidarRotToUtm(old_box.rotation);
                    old_box.globalpsr = {position:{x:globalpos.x,y:globalpos.y,z:globalpos.z},
                        rotation:{x:globalrot.x,y:globalrot.y,z:globalrot.z}};
                    window.editor.change_box_velocity(old_box);
                    window.editor.tracker.update_box(old_box.world.frameInfo.frame,old_box,"modify");
                }else{
                    // not found
                    let box=this.createOneBoxByAnn(nb);
                    pendingBoxList.push(box);
                }
            });

            // delete removed
            if(!not_delete){
                let toBeDelBoxes = this.boxes.filter(b=>b.delete);
                toBeDelBoxes.forEach(b=>{
                    if (b.boxEditor)
                        b.boxEditor.detach("donthide");
                    this.webglGroup.remove(b);
                    this.remove_box(b);
                })
            }
        if(only_delete_id)
            this.boxes.filter(b=>b.obj_track_id==only_delete_id).forEach(b=>{
                if (b.boxEditor)
                    b.boxEditor.detach("donthide");
                this.webglGroup.remove(b);
                this.remove_box(b);
            });
            pendingBoxList.forEach(b=>{
                this.boxes.push(b);                
            })


            //todo, restore point color
            //todo, update imagecontext, selected box, ...
            //refer to normal delete operation
            // re-color again
            this.world.lidar.recolor_all_points(); 

            this.color_boxes();

            // add new boxes
            pendingBoxList.forEach(b=>{
                this.webglGroup.add(b);                    
            })
            this.resetModified();
            if (done)
                done();
        }

    this.createOneBoxByAnn = function(annotation,dontcalc_vel){
        let b = annotation;
        
        let mesh = this.createCuboid(b.psr.position,
            b.psr.scale, 
            b.psr.rotation,
            b.obj_type,
            b.obj_id,
            b.obj_attr,dontcalc_vel);

        mesh.score = 1.0;

        if (b.annotator)
            mesh.annotator = b.annotator;
        if (b.follows)
            mesh.follows = b.follows;
        // if(b.velocity)
        //     mesh.velocity = b.velocity;
        if(b.timestamp)
            mesh.timestamp = b.timestamp;
        
        return mesh;  
    };

    this.createBoxes = function(annotations,dontcalc_vel){
        return annotations.map((b)=>{
            return this.createOneBoxByAnn(b,dontcalc_vel);
        });
    };
    
    this.box_local_id = 0;
    this.get_new_box_local_id=function(){
        var ret = this.box_local_id;
        this.box_local_id+=1;
        return ret;
    };


    this.color_box = function(box)
    {
        if (this.data.cfg.color_obj == "category" || this.data.cfg.color_obj == "no")
        {
            let color = globalObjectCategory.get_color_by_category(box.obj_type,box.world.frameInfo.scene.substring(0,4) == 'nusc');
            box.material.color.r=color.x;
            box.material.color.g=color.y;
            box.material.color.b=color.z;
        }
        else
        {

            let color = globalObjectCategory.get_color_by_id(box.obj_track_id);
            box.material.color.r=color.x;
            box.material.color.g=color.y;
            box.material.color.b=color.z;
        }
    }

    this.color_boxes = function()
    {
        this.boxes.forEach(box=>{
            this.color_box(box);            
        })
    }
}


export{Annotation}