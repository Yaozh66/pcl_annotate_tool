
import { CubeRefractionMapping } from "./lib/three.module.js";
import {saveWorldList} from "./save.js"

var Header=function(ui, data, cfg, onSceneChanged, onFrameChanged, onObjectSelected, onCameraChanged){

    this.ui = ui;
    this.data =  data;
    this.cfg = cfg;
    this.boxUi = ui.querySelector("#box");
    this.refObjUi = ui.querySelector("#ref-obj");
    this.sceneSelectorUi = ui.querySelector("#scene-input");
    this.frameSelectorUi = ui.querySelector("#frame-input");
    this.objectSelectorUi = ui.querySelector("#object-selector");
    this.cameraSelectorUi = ui.querySelector("#camera-selector");
    this.changedMarkUi = ui.querySelector("#changed-mark");

    this.onSceneChanged = onSceneChanged;
    this.onFrameChanged = onFrameChanged;
    this.onObjectSelected = onObjectSelected;
    this.onCameraChanged = onCameraChanged;


    if (cfg.disableSceneSelector){
        this.sceneSelectorUi.style.display="none";
    }

    if (cfg.disableFrameSelector){
        this.frameSelectorUi.style.display="none";
    }

    if (cfg.disableCameraSelector){
        this.cameraSelectorUi.style.display="none";
    }

    // update scene selector ui
    this.sceneSelectorUi.onchange = (e)=>{this.onSceneChanged(e);};
    this.objectSelectorUi.onchange = (e)=>{this.onObjectSelected(e);};
    this. frameSelectorUi.onchange = (e)=>{this.onFrameChanged(e);};
    this.cameraSelectorUi.onchange = (e)=>{this.onCameraChanged(e);};

    this.setObject = function(id)
    {
        this.objectSelectorUi.value = id;
    }

    this.clear_box_info = function(){
        this.boxUi.innerHTML = '';
    };
    
    this.update_box_info = function(box){
        var scale = box.scale;
        var pos = box.position;
        var rotation = box.rotation;
        var points_number = box.world.lidar.get_box_points_number(box);
        let distance = Math.sqrt(pos.x*pos.x + pos.y*pos.y).toFixed(2);
        var globalpos = box.globalpsr.position;
        var velocity = box.velocity;

        if(velocity)
            this.boxUi.innerHTML = "<span>" + box.obj_type +"-"+box.obj_track_id +
                                   (box.annotator? ("</span> | <span title='annotator'>" + box.annotator) : "") +
                                   "</span> | <span title='distance'>" + distance +
                                   "</span> | <span title='position'>"+pos.x.toFixed(2) +" "+pos.y.toFixed(2) + " " + pos.z.toFixed(2) +
                                   "</span> | <span title='scale'>" +scale.x.toFixed(2) +" "+scale.y.toFixed(2) + " " + scale.z.toFixed(2) +
                                   "</span> | <span title='rotation'>" +
                                    (rotation.x*180/Math.PI).toFixed(2)+" "+(rotation.y*180/Math.PI).toFixed(2)+" "+(rotation.z*180/Math.PI).toFixed(2)+
                                   "</span> | <span title='global_pos'>"+globalpos.x.toFixed(2) +" "+globalpos.y.toFixed(2) + " " + globalpos.z.toFixed(2) +
                                   "</span> | <span title='velocity'>"+velocity[0].toFixed(2) +" "+velocity[1].toFixed(2)+
            "</span> | <span title = 'points'>" + points_number + "</span> ";
        else
            this.boxUi.innerHTML = "<span>" + box.obj_type +"-"+box.obj_track_id +
                (box.annotator? ("</span> | <span title='annotator'>" + box.annotator) : "") +
                "</span> | <span title='distance'>" + distance +
                "</span> | <span title='position'>"+pos.x.toFixed(2) +" "+pos.y.toFixed(2) + " " + pos.z.toFixed(2) +
                "</span> | <span title='scale'>" +scale.x.toFixed(2) +" "+scale.y.toFixed(2) + " " + scale.z.toFixed(2) +
                "</span> | <span title='rotation'>" +
                (rotation.x*180/Math.PI).toFixed(2)+" "+(rotation.y*180/Math.PI).toFixed(2)+" "+(rotation.z*180/Math.PI).toFixed(2)+
                "</span> | <span title='global_pos'>"+globalpos.x.toFixed(2) +" "+globalpos.y.toFixed(2) + " " + globalpos.z.toFixed(2) +
                "</span> | <span title = 'points'>" + points_number + "</span> ";

        if (box.follows){
            this.boxUi.innerHTML += "| F:"+box.follows.obj_track_id;
        }
    },

    this.set_ref_obj = function(marked_object){
        this.refObjUi.innerHTML="| Ref: "+marked_object.scene+"/"+marked_object.frame+": "+marked_object.ann.obj_type+"-"+marked_object.ann.obj_id;
    },

    this.set_frame_info =function(scene, frame, on_scene_changed){
        
        if (this.sceneSelectorUi.value != scene){
            this.sceneSelectorUi.value = scene;
            on_scene_changed(scene);
        }
        document.getElementById("show-timestamp").innerHTML = "Timestamp: "+this.data.meta[scene]["timestamp"][this.data.world.frameInfo.frame_index].toString()+"&nbsp&nbsp";

        // this.frameSelectorUi.value = frame;
    },

    this.clear_frame_info = function(scene, frame){

    },
    
    this.updateModifiedStatus = function(){
        let frames = this.data.worldList.filter(w=>w.annotation.modified);
        if (frames.length > 0)
            this.ui.querySelector("#changed-mark").className = 'ui-button alarm-mark';
        else
            this.ui.querySelector("#changed-mark").className = 'ui-button';
    }

    this.ui.querySelector("#changed-mark").onmouseenter = ()=>{
        let items = "";
        let frames = this.data.worldList.filter(w=>w.annotation.modified).map(w=>w.frameInfo);
        frames.forEach(f=>{
            items += "<div class='modified-world-item'>" + f.frame + '</div>';
        });

        if (frames.length > 0){
            this.ui.querySelector("#changed-world-list").innerHTML = items;
            this.ui.querySelector("#changed-world-list-wrapper").style.display = 'inherit';
        }
    }

    this.ui.querySelector("#changed-mark").onmouseleave = ()=>{
        this.ui.querySelector("#changed-world-list-wrapper").style.display = 'none';
    }

    this.ui.querySelector("#save-button").onclick = ()=>{
        saveWorldList(this.data.world);
    }
};


export {Header}