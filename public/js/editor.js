import * as THREE from './lib/three.module.js';

import {ViewManager} from "./view.js";
import {FastToolBox, FloatLabelManager} from "./floatlabel.js";
import {Mouse} from "./mouse.js";
import {BoxEditor, BoxEditorManager} from "./box_editor.js";
import {ImageContextManager} from "./image.js";
import {globalObjectCategory} from "./obj_cfg.js";

import {objIdManager} from "./obj_id_list.js";
import {Header} from "./header.js";
import {BoxOp} from './box_op.js';
import {AutoAdjust} from "./auto-adjust.js";
import {PlayControl} from "./play.js";
import {reloadWorldList, saveWorldList} from "./save.js";
import {logger, create_logger} from "./log.js";
import {Calib} from "./calib.js";
import {Trajectory} from "./trajectory.js";
import { ContextMenu } from './context_menu.js';
import { InfoBox } from './info_box.js';
import {CropScene} from './crop_scene.js';
import { ConfigUi } from './config_ui.js';
import { MovableView } from './popup_dialog.js';
import {globalKeyDownManager} from './keydown_manager.js';
import {vector_range} from "./util.js"
import { checkScene } from './error_check.js';
import {tracker} from "./track.js";


function Editor(editorUi, wrapperUi, editorCfg, data, name="editor"){

    // create logger before anything else.
    create_logger(editorUi.querySelector("#log-wrapper"), editorUi.querySelector("#log-button"));
    this.logger = logger;
    this.editorCfg = editorCfg;
    this.sideview_enabled = true;
    this.editorUi = editorUi;
    this.wrapperUi = wrapperUi;
    this.container = null;
    this.name = name;

    this.data = data;
    this.scene = null;
    this.renderer = null;
    this.selected_box = null;
    this.windowWidth = null;
    this.windowHeight= null;
    this.floatLabelManager = null;
    this.operation_state = {
            key_pressed : false,
            box_navigate_index:0,
        };
    this.view_state = {
        lock_obj_track_id : "",
        lock_obj_in_highlight : false,  // focus mode
        autoLock: function(trackid, focus){
            this.lock_obj_track_id = trackid;
            this.lock_obj_in_highlight = focus;
        }
    };
    this.calib = new Calib(this.data, this);

    this.header = null;
    this.imageContextManager = null;
    this.boxOp = null;
    this.boxEditorManager  = null; 
    this.params={};
    this.currentMainEditor = this;  // who is on focus, this or batch-editor-manager?

    this.init = function(editorUi) {
    
        let self = this;
        this.editorUi = editorUi;

        this.playControl = new PlayControl(this.data);

        this.configUi = new ConfigUi(editorUi.querySelector("#config-button"), editorUi.querySelector("#config-wrapper"), this);

        this.header = new Header(editorUi.querySelector("#header"), this.data, this.editorCfg,
            (e)=>{
                this.scene_changed(e.currentTarget.value);
                //event.currentTarget.blur();
            },
            (e)=>{this.frame_changed(e)},
            (e)=>{this.object_changed(e)},
            (e)=>{this.camera_changed(e)}
        );

        // that way, the operation speed may be better
        // if we load all worlds, we can speed up batch-mode operations, but the singl-world operations slows down.
        // if we use two seperate scenes. can we solve this problem?
        this.scene = new THREE.Scene();
        this.mainScene = this.scene; //new THREE.Scene();

        this.data.set_webglScene(this.scene, this.mainScene);

        this.renderer = new THREE.WebGLRenderer( { antialias: true, preserveDrawingBuffer: true } );
        this.renderer.setPixelRatio( window.devicePixelRatio );
        
        this.container = editorUi.querySelector("#container");
        this.container.appendChild( this.renderer.domElement );   
        

        this.boxOp = new BoxOp(this.data);
        this.viewManager = new ViewManager(this.container, this.scene, this.mainScene, this.renderer, 
            function(){self.render();}, 
            function(box){self.on_box_changed(box)},
            this.editorCfg);

        this.imageContextManager = new ImageContextManager(
                this.editorUi.querySelector("#content"), 
                this.editorUi.querySelector("#camera-selector"),
                this.editorCfg,
                (lidar_points)=>this.on_img_click(lidar_points));


        if (!this.editorCfg.disableRangeCircle)
            this.addRangeCircle();
    
        this.floatLabelManager = new FloatLabelManager(this.editorUi, this.container, this.viewManager.mainView,function(box){self.selectBox(box);});
        this.fastToolBox = new FastToolBox(this.editorUi.querySelector("#obj-editor"), (event)=>this.handleFastToolEvent(event));

        this.axis = new THREE.AxesHelper(1);

        this.scene.add(this.axis);
    
        window.addEventListener( 'resize', function(){self.onWindowResize();}, false);

        if (!this.editorCfg.disableMainViewKeyDown){
            this.keydownHandler = (event)=>this.keydown(event);
            globalKeyDownManager.register(this.keydownHandler, "main editor");
        }

        this.globalKeyDownManager = globalKeyDownManager;

        this.objectTrackView = new Trajectory(
            this.editorUi.querySelector("#object-track-wrapper")
        );

        this.infoBox = new InfoBox(
            this.editorUi.querySelector("#info-wrapper")
        );

        this.cropScene = new CropScene(
            this.editorUi.querySelector("#crop-scene-wrapper"),
            this
        );

        this.contextMenu = new ContextMenu(this.editorUi.querySelector("#context-menu-wrapper"));        

        this.boxEditorManager = new BoxEditorManager(
            document.querySelector("#batch-box-editor"),
            this.viewManager,
            this.objectTrackView,
            this.editorCfg,
            this.boxOp,
            this.header,
            this.contextMenu,
            this.configUi,
            (b)=>this.on_box_changed(b),
            (b,r)=>this.remove_box(b,r),   // on box remove
            ()=>{
            });  //func_on_annotation_reloaded
        this.boxEditorManager.hide();
         
        let boxEditorUi = this.editorUi.querySelector("#main-box-editor-wrapper");
        this.boxEditor= new BoxEditor(
            boxEditorUi,
            null,  // no box editor manager
            this.viewManager, 
            this.editorCfg, 
            this.boxOp, 
            (b)=>this.on_box_changed(b),
            (b)=>this.remove_box(b),
            "main-boxe-ditor");
        this.boxEditor.detach(); // hide it
        this.boxEditor.setResize("both");
        this.boxEditor.moveHandle = new MovableView(
            boxEditorUi.querySelector("#focuscanvas"),
            boxEditorUi.querySelector("#sub-views"),
            ()=>{
                this.boxEditor.update();
                this.render();
            }
        );

        this.tracker = new tracker(editorCfg);

        this.mouse = new Mouse(
            this.viewManager.mainView,
            this.operation_state,
            this.container, 
            this.editorUi,
            function(ev){self.handleLeftClick(ev);}, 
            function(ev){self.handleRightClick(ev);}, 
            function(x,y,w,h,ctl,shift){self.handleSelectRect(x,y,w,h,ctl,shift);});

        this.autoAdjust=new AutoAdjust(this.boxOp, this.mouse, this.header);
        if (!this.editorCfg.disableGrid)
            this.installGridLines()
        window.onbeforeunload = function() {
            return "Exit?";
        };
        this.onWindowResize();
    };
    this.run = function(){
        this.render();
        this.imageContextManager.init_image_op(()=>this.selected_box);
        this.add_global_obj_type();
    };

    this.hide = function(){
        this.wrapperUi.style.display="none";
    };
    this.show = function(){
        this.wrapperUi.style.display="block";
    };

    this.moveRangeCircle = function(world){
        if (this.rangeCircle.parent){
            world.webglGroup.add(this.rangeCircle);
        }
    };
    this.addRangeCircle= function(){
        
        var h = 1;
                        
        var body = [
        ];
        
        var segments=64;
        for (var i = 0; i<segments; i++){
            var theta1 = (2*Math.PI/segments) * i;
            var x1 = Math.cos(theta1);
            var y1 = Math.sin(theta1);

            var theta2 = 2*Math.PI/segments * ((i+1)%segments);
            var x2 = Math.cos(theta2);
            var y2 = Math.sin(theta2);

            body.push(x1,y1,h,x2,y2,h);
            body.push(0.6*x1,0.6*y1,h,0.6*x2,0.6*y2,h);
            body.push(2.0*x1,2.0*y1,h,2.0*x2,2.0*y2,h);
        }

        this.data.dbg.alloc();
        var bbox = new THREE.BufferGeometry();
        bbox.setAttribute( 'position', new THREE.Float32BufferAttribute(body, 3 ) );
        
        var box = new THREE.LineSegments( bbox, 
            new THREE.LineBasicMaterial( { color: 0x888800, linewidth: 1, opacity: 0.5, transparent: true } ) );    
         
        box.scale.x=50;
        box.scale.y=50;
        box.scale.z=-3;
        box.position.x=0;
        box.position.y=0;
        box.position.z=0;
        box.computeLineDistances();
        this.rangeCircle = box;
        this.scene.add(box);
    };
    this.showRangeCircle = function(show){

        if (show){
            if (this.data.world)
            {
                this.data.world.webglGroup.add(this.rangeCircle);
            }
        }
        else 
        {
            if (this.rangeCircle.parent)
                this.rangeCircle.parent.remove(this.rangeCircle);
        }

        this.render();
    };

    this.hideGridLines = function(){
        var svg = this.editorUi.querySelector("#grid-lines-wrapper");
        svg.style.display="none";
    };
    this.showGridLines = function(){
        var svg = this.editorUi.querySelector("#grid-lines-wrapper");
        svg.style.display="";
    };
    this.installGridLines= function(){
        
        var svg = this.editorUi.querySelector("#grid-lines-wrapper");

        for (var i=1; i<10; i++){
            const line = document. createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", "0%");
            line.setAttribute("y1", String(i*10)+"%");
            line.setAttribute("x2", "100%");
            line.setAttribute("y2", String(i*10)+"%");
            line.setAttribute("class", "grid-line");
            svg.appendChild(line);
        }

        for (var i=1; i<10; i++){
            const line = document. createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("y1", "0%");
            line.setAttribute("x1", String(i*10)+"%");
            line.setAttribute("y2", "100%");
            line.setAttribute("x2", String(i*10)+"%");
            line.setAttribute("class", "grid-line");
            svg.appendChild(line);
        }
        
    };

    this.handleFastToolEvent= function(event){

        let self = this;
        switch (event.currentTarget.id){
        case "label-del":
            self.remove_selected_box();
            self.header.updateModifiedStatus();
            break;
        case "label-gen-id":
            let id = objIdManager.generateNewUniqueId();
            self.fastToolBox.setValue(self.selected_box.obj_type, id, self.selected_box.obj_attr);
            self.setObjectId(id);
            break;
        case "label-copy":
            if (!this.selected_box.obj_track_id)
                this.infoBox.show("Error", "Please assign object track ID.");
            else
                self.autoAdjust.mark_bbox(self.selected_box);
            break;
        case "label-auto-adjust":
            // this.autoAdjust.smart_paste(self.selected_box, null, (b)=>this.on_box_changed(b));
            this.boxOp.auto_rotate_xyz(this.selected_box, null, null,
                (b)=>this.on_box_changed(b),
                "noscaling");
           break;
        case "label-batchedit":
            {
                if (!this.ensureBoxTrackIdExist())
                    break;
                if (!this.ensurePreloaded())
                    break;
                this.header.setObject(this.selected_box.obj_track_id);
                this.editBatch(
                    this.data.world.frameInfo.scene,
                    this.data.world.frameInfo.frame,
                    this.selected_box.obj_track_id,
                    this.selected_box.obj_type
                );
            }
            break;
        case "label-trajectory":
            this.showTrajectory();            
            break;
        case "label-edit":
            event.currentTarget.blur();
            self.selectBox(self.selected_box);
            break;
        case "label-highlight":
            event.currentTarget.blur();
            if (self.selected_box.in_highlight){
                self.cancelFocus(self.selected_box);
                self.view_state.lock_obj_in_highlight = false
            }
            else {
                self.focusOnSelectedBox(self.selected_box);
            }
            break;
        case "label-rotate":
            event.currentTarget.blur();
            self.transform_bbox("z_rotate_reverse");
            break;
        case "object-category-selector":
            this.object_category_changed(event);
            break;
        case "object-track-id-editor":
            this.object_track_id_changed(event);
            break;
        case "attr-input":
            this.object_attribute_changed(event.currentTarget.value);
            break;
        default:
            this.handleContextMenuEvent(event);
            break;   
        }
    };

    this.cancelFocus= function(box){
        
        box.in_highlight = false;
        //view_state.lock_obj_in_highlight = false; // when user unhighlight explicitly, set it to false
        this.data.world.lidar.cancel_highlight(box);
        this.floatLabelManager.restore_all();
        
        this.viewManager.mainView.save_orbit_state(box.scale);
        this.viewManager.mainView.orbit.reset();
    };

    this.focusOnSelectedBox = function(box){
        if (this.editorCfg.disableMainView)
            return;

        if (box){
            this.data.world.lidar.highlight_box_points(box);
            
            this.floatLabelManager.hide_all();
            this.viewManager.mainView.orbit.saveState();

            //this.viewManager.mainView.camera.position.set(this.selected_box.position.x+this.selected_box.scale.x*3, this.selected_box.position.y+this.selected_box.scale.y*3, this.selected_box.position.z+this.selected_box.scale.z*3);

            let posG = this.data.world.lidarPosToScene(box.position);
            this.viewManager.mainView.orbit.target.x = posG.x;
            this.viewManager.mainView.orbit.target.y = posG.y;
            this.viewManager.mainView.orbit.target.z = posG.z;

            this.viewManager.mainView.restore_relative_orbit_state(box.scale);
            this.viewManager.mainView.orbit.update();

            this.render();
            box.in_highlight=true;
            this.view_state.lock_obj_in_highlight = true;
        }
    };
    
    this.showTrajectory = function(){

        if (!this.selected_box){
            this.infoBox.show("Error!","No selected box")
            return;
        }

        if (!this.selected_box.obj_track_id){
            console.error("no track id");
            this.infoBox.show("Error!","No Track ID!")
            return;
        }

        let tracks = this.data.worldList.map(w=>{
            let box = w.annotation.findBoxByTrackId(this.selected_box.obj_track_id);
            let ann = null;
            if (box){
                ann = w.annotation.boxToAnn(box);
                ann.psr.position = ann.globalpsr.position;
                ann.psr.rotation = ann.globalpsr.rotation;
            } 
            return [w.frameInfo.frame, ann, w==this.data.world]
        });


        tracks.sort((a,b)=> (a[0] > b[0])? 1 : -1);

        this.objectTrackView.setObject(
            this.selected_box.obj_type,
            this.selected_box.obj_track_id,
            tracks,
            (targetFrame)=>{  //onExit
                this.load_world(this.data.world.frameInfo.scene, targetFrame);
            }
        );
    }

    // return true to close contextmenu
    // return false to keep contextmenu
    this.handleContextMenuEvent =async function(event){
        switch(event.currentTarget.id)
        {
        case "cm-play-2fps":
            this.playControl.play((w)=>{this.on_load_world_finished(w)}, 2);
            break;
        case "cm-play-10fps":
            this.playControl.play((w)=>{this.on_load_world_finished(w)}, 10);
            break;
        case "cm-play-20fps":
            this.playControl.play((w)=>{this.on_load_world_finished(w)}, 20);
            break;
        case "cm-play-50fps":
            this.playControl.play((w)=>{this.on_load_world_finished(w)}, 50);
            break;
        case 'cm-paste':
            let box = this.add_box_on_mouse_pos_by_ref();
            if (!event.shiftKey)
                this.boxOp.auto_rotate_xyz(box, null, null,
                    b=>this.on_box_changed(b),
                    "noscaling");
            break;
        case 'cm-prev-frame':
            this.previous_frame();
            break;
        case 'cm-next-frame':
            this.next_frame();
            break;
        case 'cm-last-frame':
            this.last_frame();
            break;
        case 'cm-first-frame':
            this.first_frame();
            break;
        case 'cm-go-to-10hz':
            this.load_world(this.data.world.frameInfo.scene+"_10hz", this.data.world.frameInfo.frame)
            break;
        case 'cm-go-to-full-2hz':
            this.load_world(this.data.world.frameInfo.scene+"_full_2hz", this.data.world.frameInfo.frame)
            break;
        case 'cm-go-to-2hz':
            this.load_world(this.data.world.frameInfo.scene.split("_")[0], this.data.world.frameInfo.frame)
            break;
        case 'cm-save':
            saveWorldList(this.data.world);
            break;
        case "cm-reload":
            {
                reloadWorldList([this.data.world], ()=>{
                    this.on_load_world_finished(this.data.world);
                    this.header.updateModifiedStatus();
                });
            }
            break;
        case "cm-reload-all":
            {
                let modifiedFrames = this.data.worldList.filter(w=>w.annotation.modified);

                if (modifiedFrames.length > 0)
                {
                    this.infoBox.show(
                        "Confirm",
                        `Discard changes to ${modifiedFrames.length} frames, continue to reload?`,
                        ["yes","no"],
                        (choice)=>{
                            if (choice=="yes")
                            {
                                reloadWorldList(this.data.worldList, ()=>{
                                    this.on_load_world_finished(this.data.world);
                                    this.header.updateModifiedStatus();

                                });
                            }
                        }
                    );                
                }
                else
                {
                    reloadWorldList(this.data.worldList, ()=>{
                        this.on_load_world_finished(this.data.world);
                        this.header.updateModifiedStatus();
                    });
                    objIdManager.forceUpdate();
                }
            }
            break;
        case "cm-stop":
            this.playControl.stop_play();
            break;
        case "cm-pause":
            this.playControl.pause_resume_play();
            break;
        case "cm-prev-object":
            this.select_previous_object();
            break;
        case "cm-next-object":
            this.select_previous_object();
            break;
        case "cm-show-frame-info":
            {
                let info = {"scend-id": this.data.world.frameInfo.scene,
                            "frame": this.data.world.frameInfo.frame
                           };
                
                if (this.data.world.frameInfo.sceneMeta.desc)
                {
                    info = {
                        ...info, 
                        ...this.data.world.frameInfo.sceneMeta.desc,                        
                    };
                }

                this.infoBox.show("Frame info - " + this.data.world.frameInfo.scene, JSON.stringify(info,null,"<br>"));
            }
            break;
        case "cm-show-stat":
            {
                let scene = this.data.world.frameInfo.scene;
                objIdManager.load_obj_ids_of_scene(scene, (objs)=>{
                    let info = {
                        objects: objs.length,
                        boxes: objs.reduce((a,b)=>a+b.count, 0),
                        frames: this.data.world.frameInfo.sceneMeta.frames.length,
                    };
                    this.infoBox.show("Stat - " + scene, JSON.stringify(info, null,"<br>"));
                });
            }
            break;
        case 'cm-check-scene':
            let scene = this.data.world.frameInfo.scene;
            checkScene(scene);
            logger.show();
            logger.errorBtn.onclick();
            break;
        case 'cm-track-scene':
            await this.tracker.track(this.data.world.frameInfo.scene,this.data.world.frameInfo.frame_index)
            break;
        case 'cm-track-all-static':
            this.autoAnnotate_Static(this.data.world.frameInfo.frame_index)
            break;
        case "cm-reset-view":
            this.resetView();
            break;
        case "cm-delete":
            this.remove_selected_box();
            this.header.updateModifiedStatus();
            break;
        case "cm-edit-multiple-instances":
            this.enterBatchEditMode();
            
            break;
        case "cm-auto-ann-background":
            this.autoAnnInBackground();
            break;
        case "cm-interpolate-background":
            this.interpolateInBackground();
            break;
        case "cm-show-trajectory":

            this.showTrajectory();
            break;
        case "cm-select-as-ref":
            if (!this.selected_box.obj_track_id)
            {
                this.infoBox.show("Error", "Please assign object track ID.");
                return false;
            }
            else
                this.autoAdjust.mark_bbox(this.selected_box);
            break;
        case "cm-change-id-to-ref":
            if (!this.ensureRefObjExist()){}
                break;
            this.setObjectId(this.autoAdjust.marked_object.ann.obj_id);
            this.fastToolBox.setValue(this.selected_box.obj_type, 
                this.selected_box.obj_track_id, 
                this.selected_box.obj_attr);
            break;
        case "cm-change-id-to-ref-in-scene":

            if (!this.ensureBoxTrackIdExist())
                break;
            if (!this.ensurePreloaded())
                break;
            if (!this.ensureRefObjExist())
                break;
            this.data.worldList.forEach(w=>{
                let box = w.annotation.boxes.find(b=>b.obj_track_id == this.selected_box.obj_track_id &&  b.obj_type == this.selected_box.obj_type);
                if (box && box !== this.selected_box){
                    box.obj_track_id = this.autoAdjust.marked_object.ann.obj_id;
                    w.annotation.setModified();
                }
            });
            this.setObjectId(this.autoAdjust.marked_object.ann.obj_id);
            this.fastToolBox.setValue(this.selected_box.obj_type, 
                this.selected_box.obj_track_id, 
                this.selected_box.obj_attr);

            break;
        case "cm-follow-ref":
            if (!this.ensureBoxTrackIdExist())
                break;
            if (!this.ensurePreloaded())
                break;
            if (!this.ensureRefObjExist())
                break;
            this.autoAdjust.followsRef(this.selected_box);
            this.header.updateModifiedStatus();
            this.editBatch(
                this.data.world.frameInfo.scene,
                this.data.world.frameInfo.frame,
                this.selected_box.obj_track_id,
                this.selected_box.obj_type
            );
            break;
        case 'cm-follow-static-objects':
            if (!this.ensureBoxTrackIdExist())
                break;
            if (!this.ensurePreloaded())
                break;
            this.autoAdjust.followStaticObjects(this.selected_box);
            this.header.updateModifiedStatus();

            this.editBatch(
                this.data.world.frameInfo.scene,
                this.data.world.frameInfo.frame,
                this.selected_box.obj_track_id,
                this.selected_box.obj_type
            );

            break;
        case "cm-sync-followers":
            if (!this.ensurePreloaded())
                break;
            let res=this.autoAdjust.syncFollowers(this.selected_box);
            if(!res)
                window.editor.infoBox.show("Warning!","no followers");

            this.header.updateModifiedStatus();
            this.render();
            break;
        case "cm-delete-obj":
            //let saveList=[];
            this.data.worldList.forEach(w=>{
                let box = w.annotation.boxes.find(b=>b.obj_track_id == this.selected_box.obj_track_id);
                if (box && box !== this.selected_box){
                    w.annotation.unload_box(box);
                    w.annotation.remove_box(box);
                    //saveList.push(w);
                    w.annotation.setModified();
                }
            });
            this.remove_selected_box();
            this.header.updateModifiedStatus();
            break;
        case "cm-modify-obj-type":
            if (!this.ensurePreloaded())
                break;
            this.data.worldList.forEach(w=>{
                let box = w.annotation.boxes.find(b=>b.obj_track_id == this.selected_box.obj_track_id);
                if (box && box !== this.selected_box){
                    box.obj_type = this.selected_box.obj_type;
                    box.obj_attr = this.selected_box.obj_attr;
                    w.annotation.setModified();
                    window.editor.tracker.update_box(box.world.frameInfo.frame,box,"modify");
                }
            });
            this.header.updateModifiedStatus();
            break;
        case "cm-modify-obj-size":
            if (!this.ensurePreloaded())
                break;
            this.data.worldList.forEach(w=>{
                let box = w.annotation.boxes.find(b=>b.obj_track_id == this.selected_box.obj_track_id);
                if (box && box !== this.selected_box){
                    box.scale.x = this.selected_box.scale.x;
                    box.scale.y = this.selected_box.scale.y;
                    box.scale.z = this.selected_box.scale.z;
                    w.annotation.setModified();
                    window.editor.tracker.update_box(box.world.frameInfo.frame,box,"modify");
                }
            });
            this.header.updateModifiedStatus();
            break;
        default:
            console.log('unhandled', event.currentTarget.id, event.type);
        }
        return true; 
    };

    this.autoAnnotate_Static = function(frame_index){
        if (!this.ensurePreloaded())
            return;
        let worldList = this.data.worldList.filter(w=>w.frameInfo.scene == this.data.world.frameInfo.scene
            && w.frameInfo.frame_index >= Math.max(frame_index-1,0)
            && w.frameInfo.frame_index <= Math.min(frame_index+1,this.data.world.frameInfo.sceneMeta.frames.length-1));
        let thisworld = worldList.find(w=>(w.frameInfo.frame_index==frame_index));
        thisworld.annotation.setModified();
        let boxToannotateID = objIdManager.findStaticBox();
        boxToannotateID.forEach(b=>{
            let has_box_world = worldList.find(w=>w.annotation.findBoxByTrackId(b))
            if(!has_box_world)
                return;
            let onFinishOneBox = ()=>{
                this.viewManager.render();
            }
            this.boxOp.copyGlobalPos(has_box_world, has_box_world.annotation.findBoxByTrackId(b), onFinishOneBox,thisworld );
        })
    }


    this.render= function(){

        this.viewManager.mainView.render();
        this.boxEditor.boxView.render();

        this.floatLabelManager.update_all_position();
        if (this.selected_box)
            this.fastToolBox.setPos(this.floatLabelManager.getLabelEditorPos(this.selected_box.obj_local_id));
    };

    this.resetView = function(targetPos){
        if (!targetPos){
            let center = this.data.world.lidar.computeCenter();
            targetPos = {...center};//{x:0, y:0, z:50};
            targetPos.z += 50;
        }
        else
            targetPos.z = 50;

        let pos = this.data.world.lidarPosToScene(targetPos);
        this.viewManager.mainView.orbit.object.position.set(pos.x, pos.y, pos.z);  //object is camera
        this.viewManager.mainView.orbit.target.set(pos.x, pos.y, 0);
        this.viewManager.mainView.orbit.update(); 
        this.render();
    };

    this.scene_changed=async function(sceneName){
        if (sceneName.length == 0)
            return;
        console.log("choose sceneName " + sceneName);
        if(this.data.world)
            if(this.data.world.frameInfo.scene == this.editorUi.querySelector("#scene-input").value)
                return;
            else{
                let frame = this.editorUi.querySelector("#frame-input").value;
                if(!frame)
                    return;
                let create_time = new Date().getTime();
                var meta = this.data.getMetaBySceneName(sceneName);
                if (!meta)
                    meta = await this.data.readSceneMetaData(sceneName);
                if (meta.camera)
                    this.imageContextManager.updateCameraList(meta.camera);
                if (Number(frame)>meta.frames.length) {
                    // alert("Please Write a Number no more than " + meta.frames.length);
                    this.infoBox.show("Error!","Please Write a Number no more than " + meta.frames.length);
                    return;
                }
                if(sceneName.substring(0,4)=="nusc"){
                    if(meta.is_key_frame[Number(frame)-1])
                        document.getElementById("show-keyframe").innerHTML = "Keyframe:"+meta.frames[Number(frame)-1]+"&nbsp&nbsp";
                    else
                        document.getElementById("show-keyframe").innerHTML = "Nonkeyframe:"+meta.frames[Number(frame)-1]+"&nbsp&nbsp";
                }
                frame = meta.frames[Number(frame)-1];
                await this.load_world(sceneName, frame);
                let finish_time = new Date().getTime();
                console.log(finish_time, sceneName, frame, "loaded in ", finish_time - create_time, "ms");
                objIdManager.setCurrentScene(sceneName);
            }

    };

    this.frame_changed=async function(event){
        let create_time = new Date().getTime();
        var sceneName = this.editorUi.querySelector("#scene-input").value;

        if (sceneName.length == 0 && this.data.world)
            sceneName = this.data.world.frameInfo.scene;

        if (sceneName.length == 0)
            return;

        var frame =  event.currentTarget.value;
        var meta = this.data.getMetaBySceneName(sceneName);
        if (!meta){
            objIdManager.setCurrentScene(sceneName);
            meta = await this.data.readSceneMetaData(sceneName);
        }
        if (meta.camera)
            this.imageContextManager.updateCameraList(meta.camera);
        if (Number(frame)>meta.frames.length) {
            // alert("Please Write a Number no more than " + meta.frames.length);
            this.infoBox.show("Error!","Please Write a Number no more than " + meta.frames.length);
            return;
        }
        if(sceneName.substring(0,4)=="nusc"){
            if(meta.is_key_frame[Number(frame)-1])
                document.getElementById("show-keyframe").innerHTML = "Keyframe:"+meta.frames[Number(frame)-1]+"&nbsp&nbsp";
            else
                document.getElementById("show-keyframe").innerHTML = "Nonkeyframe:"+meta.frames[Number(frame)-1]+"&nbsp&nbsp";
        }
        frame = meta.frames[Number(frame)-1];

        await this.load_world(sceneName, frame);
        let finish_time = new Date().getTime();
        console.log(finish_time, sceneName, frame, "loaded in ", finish_time - create_time, "ms");
    };

    this.ensureBoxTrackIdExist = function() {
        if (!this.selected_box.obj_track_id)
        {
            this.infoBox.show("Error", "Please assign object track ID.");
            return false;
        }
        return true;
    }

    this.ensureRefObjExist = function() {
        if (!this.autoAdjust.marked_object)
        {
            this.infoBox.show("Notice", 'No reference object was selected');
            return false;
        }
        return true;
    }
    this.ensurePreloaded = function()
    {
        if(!this.data.world)
            return false;
        let worldList = this.data.worldList.filter(w=>w.frameInfo.scene == this.data.world.frameInfo.scene);
        worldList = worldList.sort((a,b)=>a.frameInfo.frame_index - b.frameInfo.frame_index);
        let meta = this.data.get_current_world_scene_meta();
        let allLoaded = worldList.map(w=>w.preloaded()).reduce((a,b)=>a && b, true);
        if ((worldList.length < meta.frames.length && worldList.length <= 60) || (!allLoaded))
        {
            this.data.forcePreloadScene(this.data.world.frameInfo.scene, this.data.world);

            this.infoBox.show("Notice", `Loading scene in background. Please try again later.`);
            return false;
        }
        return true;
    }
    this.interpolateInBackground = function()
    {
        if (!this.ensureBoxTrackIdExist())
            return;
        if (!this.ensurePreloaded())
            return;

        let worldList = this.data.worldList.filter(w=>w.frameInfo.scene == this.data.world.frameInfo.scene);
        worldList = worldList.sort((a,b)=>a.frameInfo.frame_index - b.frameInfo.frame_index);
        let boxList = worldList.map(w=>w.annotation.findBoxByTrackId(this.selected_box.obj_track_id));

        let applyIndList = boxList.map(b=>true);
        this.boxOp.interpolateAsync(worldList, boxList, applyIndList).then(ret=>{
            this.header.updateModifiedStatus();
            this.viewManager.render();
        });
    };
    this.enterBatchEditMode = function()
    {
        if (!this.ensureBoxTrackIdExist())
           return;

        if (!this.ensurePreloaded())
            return;

        this.header.setObject(this.selected_box.obj_track_id);

        this.editBatch(
            this.data.world.frameInfo.scene,
            this.data.world.frameInfo.frame,
            this.selected_box.obj_track_id,
            this.selected_box.obj_type
        );
    };

    this.autoAnnInBackground = function()
    {
        if (!this.ensureBoxTrackIdExist())
            return;

        if (!this.ensurePreloaded())
            return;
        let worldList = this.data.worldList.filter(w=>w.frameInfo.scene == this.data.world.frameInfo.scene);
        worldList = worldList.sort((a,b)=>a.frameInfo.frame_index - b.frameInfo.frame_index);
        let boxList = worldList.map(w=>w.annotation.findBoxByTrackId(this.selected_box.obj_track_id));
        let onFinishOneBox = (i)=>{
            this.viewManager.render();
        }
        let applyIndList = boxList.map(b=>true);
        let dontRotate = false;
        this.boxOp.interpolateAndAutoAdjustAsync(worldList, boxList, onFinishOneBox, applyIndList, dontRotate).then(ret=>{
            this.header.updateModifiedStatus();
        });
    };

    this.editBatch = function(sceneName, frame, objectTrackId, objectType){
        // hide something
        this.imageContextManager.hide();
        this.floatLabelManager.hide();

        this.viewManager.mainView.disable();
        this.boxEditor.hide();
        this.hideGridLines();
        this.editorUi.querySelector("#selectors").style.display='none';
        this.currentMainEditor = this.boxEditorManager;
        this.boxEditorManager.edit(this.data, 
            this.data.getMetaBySceneName(sceneName), 
            frame, 
            objectTrackId,
            objectType,
            (targetFrame, targetTrackId)=>{  //on exit
                this.currentMainEditor = this
                //this.keydownDisabled = false;
                this.viewManager.mainView.enable();

                this.imageContextManager.show();
                this.floatLabelManager.show();

                if (targetTrackId)
                    this.view_state.lock_obj_track_id = targetTrackId;

                this.on_load_world_finished(this.data.world);

                this.showGridLines();
                this.render();
                //this.controlGui.show();
                this.editorUi.querySelector("#selectors").style.display='inherit';

                if (targetFrame)
                {
                    this.load_world(this.data.world.frameInfo.scene, targetFrame, ()=>{  // onfinished
                        this.makeVisible(targetTrackId);
                    });
                }
            }
            );
    };

    this.gotoObjectFrame = function(frame, objId)
    {
        this.load_world(this.data.world.frameInfo.scene, frame, ()=>{  // onfinished
            this.makeVisible(objId);
        });
    };

    this.makeVisible = function(targetTrackId){
        let box = this.data.world.annotation.findBoxByTrackId(targetTrackId);

        if (box){
            if (this.selected_box != box){
                this.selectBox(box);
            }

            this.resetView({x:box.position.x, y:box.position.y, z:50});
        }

    };

    this.object_changed = function(event){
        // let sceneName = this.data.world.frameInfo.scene;
        let objectTrackId = event.currentTarget.value;
        // let obj = objIdManager.getObjById(objectTrackId);
        this.makeVisible(objectTrackId)
        // this.editBatch(sceneName, null, objectTrackId, obj.category);
    };

    this.camera_changed= function(event){
        var camera_name = event.currentTarget.value;

        this.data.set_active_image(camera_name);
        this.imageContextManager.render_2d_image();

        event.currentTarget.blur();
    };

    this.downloadWebglScreenShot = function(){
        let link = document.createElement("a");
        link.download=`${this.data.world.frameInfo.scene}-${this.data.world.frameInfo.frame}-webgl`;
        link.href=this.renderer.domElement.toDataURL("image/png", 1);
        link.click();
    };

    this.object_category_changed= function(event){
        if (this.selected_box){
            let category = event.currentTarget.value;
            objIdManager.delObject({category: this.selected_box.obj_type,
                id: this.selected_box.obj_track_id,})
            window.editor.tracker.update_box(this.selected_box.world.frameInfo.frame,this.selected_box,"delete");
            this.selected_box.obj_type = category;
            this.floatLabelManager.set_object_type(this.selected_box.obj_local_id, this.selected_box.obj_type);
            this.on_box_changed(this.selected_box);

            //todo: we don't know if the old one is already deleted.
            // could use object count number?

            objIdManager.addObject({
                category: this.selected_box.obj_type,
                id: this.selected_box.obj_track_id,count:1
            });
        }
    };

    this.setObjectId = function(id)
    {
        objIdManager.delObject({category: this.selected_box.obj_type,
            id: this.selected_box.obj_track_id,});
        window.editor.tracker.update_box(this.selected_box.world.frameInfo.frame,this.selected_box,"delete");
        this.selected_box.obj_track_id = id;
        this.floatLabelManager.set_object_track_id(this.selected_box.obj_local_id, this.selected_box.obj_track_id);

        this.view_state.lock_obj_track_id = id;

        //this.header.mark_changed_flag();
        this.on_box_changed(this.selected_box);

        objIdManager.addObject({
            category: this.selected_box.obj_type,
            id: this.selected_box.obj_track_id,count:1
        });
    }

    this.object_track_id_changed= function(event){
        if (this.selected_box){
            var id = event.currentTarget.value;
            this.setObjectId(id);            
        }
    };

    this.object_attribute_changed = function(value){
        if (this.selected_box){
            this.selected_box.obj_attr = value;
            this.floatLabelManager.set_object_attr(this.selected_box.obj_local_id, value);
            this.data.world.annotation.setModified();
            this.header.updateModifiedStatus();
        }
    };

    this.handleRightClick= function(event){
        // select new object
        if (!this.data.world){
            return;
        }
        if (event.shiftKey || event.ctrlKey)
        {
            // if ctrl or shift hold, don't select any object.
            this.contextMenu.show("world",event.layerX, event.layerY, this);
            return;
        }
        var intersects = this.mouse.getIntersects( this.mouse.onUpPosition, this.data.world.annotation.boxes );
        if ( intersects.length > 0 ) {
            //var object = intersects[ 0 ].object;
            var object = intersects[ 0 ].object;
            let target_obj = object.userData.object;
            if ( target_obj == undefined ) {
                // helper
                target_obj = object;
            }

            if (target_obj != this.selected_box){
                this.selectBox(target_obj);
            }
            this.contextMenu.show("object",event.layerX, event.layerY, this);
        } else
            // if no object is selected, popup context menu
            this.contextMenu.show("world",event.layerX, event.layerY, this);
    };

    this.on_img_click = function(lidar_point_indices){
        //这个函数目前无太大用处
        // console.log(lidar_point_indices);
        var self=this;
        let obj_type = "Car";
        this.data.world.lidar.set_spec_points_color(lidar_point_indices, {x:0,y:0,z:1});
        this.data.world.lidar.update_points_color();
        this.render();

        let pos = this.data.world.lidar.get_centroid(lidar_point_indices);
        pos.z = 0;

        let rotation = {x:0, y:0, z:this.viewManager.mainView.camera.rotation.z+Math.PI/2};

        let obj_cfg = globalObjectCategory.get_obj_cfg_by_type(obj_type,this.editorUi.querySelector("#scene-input").value.substring(0,4) == 'nusc');
        let scale = {   
            x: obj_cfg.size[0],
            y: obj_cfg.size[1],
            z: obj_cfg.size[2]
        };

        let box = this.add_box(pos, scale, rotation, obj_type, "");
        self.boxOp.auto_rotate_xyz(box, null, null, function(b){
            self.on_box_changed(b);
        });

        return;
    };
    
    this.handleSelectRect= function(x,y,w,h, ctrl, shift){

        // check if any box is inside the rectangle

        this.viewManager.mainView.camera.updateProjectionMatrix();

        let boxes = this.data.world.annotation.find_boxes_inside_rect(x,y,w,h, this.viewManager.mainView.camera);
        if (boxes.length > 0) {
            if (boxes.length == 1)
                this.selectBox(boxes[0])
            return;
        }

        let points = this.data.world.lidar.select_points_by_view_rect(x,y,w,h, this.viewManager.mainView.camera);
        let initRoationZ = this.viewManager.mainView.camera.rotation.z + Math.PI/2;

        let box = this.create_box_by_points(points, initRoationZ);

        let id = objIdManager.generateNewUniqueId();
        box.obj_track_id = id;
        if (!shift){
            try{
                this.boxOp.auto_shrink_box(box);
            }
            catch(e)
            {
                this.infoBox.show("Auto shringking box Error!",e);
            }
        }
        
        // guess obj type here
        
        box.obj_type = globalObjectCategory.guess_obj_type_by_dimension(box.scale,box.world.frameInfo.scene.substring(0,4) == "nusc");
        
        objIdManager.addObject({
            category: box.obj_type,
            id: box.obj_track_id,
            count: 1
        });


        this.imageContextManager.boxes_manager.add_box(box);
        this.floatLabelManager.add_label(box);

        this.selectBox(box);
        this.on_box_changed(box);

        if (!shift){
            this.boxOp.auto_rotate_xyz(box, ()=>{
                box.obj_type = globalObjectCategory.guess_obj_type_by_dimension(box.scale,box.world.frameInfo.scene.substring(0,4) == "nusc");
                this.floatLabelManager.set_object_type(box.obj_local_id, box.obj_type);
                this.fastToolBox.setValue(box.obj_type, box.obj_track_id, box.obj_attr);
                this.on_box_changed(box);
            });
        }
    };

    this.create_box_by_points=function(points, rotationZ){
        
        let localRot = this.data.world.sceneRotToLidar(new THREE.Euler(0,0,rotationZ, "XYZ"));
        
        let transToBoxMatrix = new THREE.Matrix4().makeRotationFromEuler(localRot)
                                                  .setPosition(0, 0, 0)
                                                  .invert();

       // var trans = transpose(euler_angle_to_rotate_matrix({x:0,y:0,z:rotation_z}, {x:0, y:0, z:0}), 4);

        let relative_position = [];
        let v = new THREE.Vector3();
        points.forEach(function(p){
            v.set(p[0],p[1],p[2]);
            let boxP = v.applyMatrix4(transToBoxMatrix);
            relative_position.push([boxP.x,boxP.y, boxP.z]);
        });

        var relative_extreme = vector_range(relative_position);
        var scale = {
            x: relative_extreme.max[0] - relative_extreme.min[0],
            y: relative_extreme.max[1] - relative_extreme.min[1],
            z: relative_extreme.max[2] - relative_extreme.min[2],
        };

        // enlarge scale a little

        let center = this.boxOp.translateBoxInBoxCoord(
            localRot,
            {
                x: (relative_extreme.max[0] + relative_extreme.min[0])/2,
                y: (relative_extreme.max[1] + relative_extreme.min[1])/2,
                z: (relative_extreme.max[2] + relative_extreme.min[2])/2,
            }
        );

        return this.data.world.annotation.add_box(center, scale, localRot, "Unknown", "");
    };

    this.handleLeftClick= function(event) {
        //select box /unselect box
        if (!this.data.world || (!this.data.world.annotation.boxes && this.data.world.radars.radarList.length==0 && !this.calib.calib_box))
            return;

        let all_boxes = this.data.world.annotation.boxes.concat(this.data.world.radars.getAllBoxes());
        all_boxes = all_boxes.concat(this.data.world.aux_lidars.getAllBoxes());

        if (this.calib.calib_box){
            all_boxes.push(this.calib.calib_box);
        }

        let intersects = this.mouse.getIntersects( this.mouse.onUpPosition, all_boxes);

        if (intersects.length == 0){
            if (this.data.world.radar_box){
                intersects = this.mouse.getIntersects( this.mouse.onUpPosition, [this.data.world.radar_box]);
            }
        }

        if ( intersects.length > 0 ) {
            //var object = intersects[ 0 ].object;
            var object = intersects[ 0 ].object;
            if ( object.userData.object !== undefined )
                this.selectBox( object.userData.object );
             else
                this.selectBox( object );
        } else
            this.unselectBox(null);
    };

    this.select_locked_object= function(){
        var self=this;
        if (this.view_state.lock_obj_track_id != ""){
            var box = this.data.world.annotation.boxes.find(function(x){
                return x.obj_track_id == self.view_state.lock_obj_track_id;
            })
            if (box){
                this.selectBox(box);
                if (self.view_state.lock_obj_in_highlight){
                    this.focusOnSelectedBox(box);
                }
            }
        }
    };

    // new_object
    this.unselectBox = function(new_object, keep_lock){

        if (new_object==null){
            if (this.viewManager.mainView && this.viewManager.mainView.transform_control.visible)
                //unselect first time
                this.viewManager.mainView.transform_control.detach();
            else{
                //unselect second time
                if (this.selected_box){
                    // restore from highlight
                    if (this.selected_box.in_highlight){
                        this.cancelFocus(this.selected_box);
                        if (!keep_lock)
                            this.view_state.lock_obj_in_highlight = false;
                    } else{
                        // unselected finally
                        //this.selected_box.material.color = new THREE.Color(parseInt("0x"+get_obj_cfg_by_type(this.selected_box.obj_type).color.slice(1)));
                        //this.selected_box.material.opacity = this.data.cfg.box_opacity;
                        this.boxOp.unhighlightBox(this.selected_box);
                        //this.floatLabelManager.unselect_box(this.selected_box.obj_local_id, this.selected_box.obj_type);
                        this.fastToolBox.hide();

                        if (!keep_lock){
                            this.view_state.lock_obj_track_id = "";
                        }

                        this.imageContextManager.boxes_manager.onBoxUnselected(this.selected_box.obj_local_id, this.selected_box.obj_type);
                        this.selected_box = null;
                        this.boxEditor.detach();

                        this.onSelectedBoxChanged(null);
                    }
                }
                else{
                    // just an empty click
                    return;
                }
            }
        }
        else{
            // selected other box
            //unselect all
            this.viewManager.mainView.transform_control.detach();
            if (this.selected_box){
                
                // restore from highlight
                
                if (this.selected_box.in_highlight){
                    this.cancelFocus(this.selected_box); 
                    if (!keep_lock){
                        this.view_state.lock_obj_in_highlight = false;
                    }
                }

                this.selected_box.material.color = new THREE.Color(parseInt("0x"+globalObjectCategory.get_obj_cfg_by_type(this.selected_box.obj_type,
                    this.selected_box.world.frameInfo.scene.substring(0,4) == "nusc").color.slice(1)));
                this.selected_box.material.opacity = this.data.cfg.box_opacity;                
                //this.floatLabelManager.unselect_box(this.selected_box.obj_local_id);
                this.fastToolBox.hide();
                this.imageContextManager.boxes_manager.onBoxUnselected(this.selected_box.obj_local_id, this.selected_box.obj_type);

                this.selected_box = null;
                this.boxEditor.detach();
                if (!keep_lock)
                    this.view_state.lock_obj_track_id = "";
            }
        }



        this.render();

    };

    this.selectBox = function(object){
        if (this.selected_box != object){
            // unselect old bbox
            var in_highlight = false;
            if (this.selected_box){
                in_highlight = this.selected_box.in_highlight;
                this.unselectBox(this.selected_box);
            }
            // select me, the first time
            this.selected_box = object;

            // switch camera
            if (!this.editorCfg.disableMainImageContext){
                var best_camera = this.imageContextManager.choose_best_camera_for_point(
                    this.selected_box.world.frameInfo.sceneMeta,
                    this.selected_box.position);
                if (best_camera)
                    this.imageContextManager.setBestCamera(best_camera);
            }

            // highlight box
            // shold change this id if the current selected box changed id.
            this.view_state.lock_obj_track_id = object.obj_track_id;

            //this.floatLabelManager.select_box(this.selected_box.obj_local_id);
            
            this.fastToolBox.setPos(this.floatLabelManager.getLabelEditorPos(this.selected_box.obj_local_id));
            this.fastToolBox.setValue(object.obj_type, object.obj_track_id, object.obj_attr);
            this.fastToolBox.show();

            this.boxOp.highlightBox(this.selected_box);

            if (in_highlight)
                this.focusOnSelectedBox(this.selected_box);

            this.save_box_info(object); // this is needed since when a frame is loaded, all box haven't saved anything.
                                        // we could move this to when a frame is loaded.
            this.boxEditor.attachBox(object);
            this.onSelectedBoxChanged(object);

        }
        else {
            //reselect the same box
            if (this.viewManager.mainView.transform_control.visible){
                this.change_transform_control_view();
            }
            else{
                //select me the second time
                //object.add(this.viewManager.mainView.transform_control);
                this.viewManager.mainView.transform_control.attach( object );
            }            
        }

        this.render();
    };

    this.adjustContainerSize = function()
    {
        let editorRect = this.editorUi.getBoundingClientRect();
        let headerRect = this.editorUi.querySelector("#header").getBoundingClientRect();

        this.container.style.height = editorRect.height - headerRect.height + "px";
    }


    this.onWindowResize= function() {

        this.adjustContainerSize();
        this.boxEditorManager.onWindowResize();

        // use clientwidth and clientheight to resize container
        // but use scrollwidth/height to place other things.
        if ( this.windowWidth != this.container.clientWidth || this.windowHeight != this.container.clientHeight ) {

            //update_mainview();
            if (this.viewManager.mainView)
                this.viewManager.mainView.onWindowResize();

            if (this.boxEditor)
                this.boxEditor.update("dontrender");

            this.windowWidth = this.container.clientWidth;
            this.windowHeight = this.container.clientHeight;
            this.renderer.setSize( this.windowWidth, this.windowHeight );
        }
        
        this.viewManager.render();
    };

    this.change_transform_control_view= function(){
        if (this.viewManager.mainView.transform_control.mode=="scale"){
            this.viewManager.mainView.transform_control.setMode( "translate" );
            this.viewManager.mainView.transform_control.showY=true;
            this.viewManager.mainView.transform_control.showX=true;
            this.viewManager.mainView.transform_control.showz=true;
        }else if (this.viewManager.mainView.transform_control.mode=="translate"){
            this.viewManager.mainView.transform_control.setMode( "rotate" );
            this.viewManager.mainView.transform_control.showY=false;
            this.viewManager.mainView.transform_control.showX=false;
            this.viewManager.mainView.transform_control.showz=true;
        }else if (this.viewManager.mainView.transform_control.mode=="rotate"){
            this.viewManager.mainView.transform_control.setMode( "scale" );
            this.viewManager.mainView.transform_control.showY=true;
            this.viewManager.mainView.transform_control.showX=true;
            this.viewManager.mainView.transform_control.showz=true;
        }
    };
    this.add_box_on_mouse_pos_by_global = function(){

        let globalP = this.autoAdjust.marked_object.ann.globalpsr.position;
        let pos = this.data.world.UtmPosTolidar(globalP);
        let globalr = this.autoAdjust.marked_object.ann.globalpsr.rotation;
        let rot = this.data.world.utmRotToLidar(globalr);
        let refbox = this.autoAdjust.marked_object.ann;
        pos.z = refbox.psr.position.z;
        let id = refbox.obj_id;

        if (this.autoAdjust.marked_object.frame == this.data.world.frameInfo.frame)
        {
            id = "";
        }

        let box = this.add_box(pos, refbox.psr.scale, rot, refbox.obj_type, id, refbox.obj_attr);

        return box;
    };


    this.add_box_on_mouse_pos_by_ref = function(){

        let globalP = this.mouse.get_mouse_location_in_world();
        // trans pos to world local pos
        let pos = this.data.world.scenePosToLidar(globalP);

        let refbox = this.autoAdjust.marked_object.ann;
        pos.z = refbox.psr.position.z;

        let id = refbox.obj_id;

        if (this.autoAdjust.marked_object.frame == this.data.world.frameInfo.frame)
        {
            id = "";
        }

        let box = this.add_box(pos, refbox.psr.scale, refbox.psr.rotation, refbox.obj_type, id, refbox.obj_attr);
        
        return box;
    };

    this.add_box_on_mouse_pos= function(obj_type){
        // todo: move to this.data.world
        let globalP = this.mouse.get_mouse_location_in_world();

        // trans pos to world local pos
        let pos = this.data.world.scenePosToLidar(globalP);

        var rotation = new THREE.Euler(0, 0, this.viewManager.mainView.camera.rotation.z+Math.PI/2, "XYZ");
        rotation = this.data.world.sceneRotToLidar(rotation);

        var obj_cfg = globalObjectCategory.get_obj_cfg_by_type(obj_type,this.editorUi.querySelector("#scene-input").value.substring(0,4) == "nusc");
        var scale = {   
            x: obj_cfg.size[0],
            y: obj_cfg.size[1],
            z: obj_cfg.size[2]
        };

        pos.z = -1.8 + scale.z/2;  // -1.8 is height of lidar

        let id = objIdManager.generateNewUniqueId();

        objIdManager.addObject({
            category: obj_type,
            id: id,count:1
        });

        let box = this.add_box(pos, scale, rotation, obj_type, id);
        
        return box;
    };

    this.add_box= function(pos, scale, rotation, obj_type, obj_track_id, obj_attr){
        let box = this.data.world.annotation.add_box(pos, scale, rotation, obj_type, obj_track_id, obj_attr);
        this.floatLabelManager.add_label(box);
        this.imageContextManager.boxes_manager.add_box(box);
        this.selectBox(box);
        return box;
    };

    this.save_box_info= function(box){
        box.last_info = {
            //obj_type: box.obj_type,
            position: {
                x: box.position.x,
                y: box.position.y,
                z: box.position.z,
            },
            rotation: {
                x: box.rotation.x,
                y: box.rotation.y,
                z: box.rotation.z,
            },
            scale: {
                x: box.scale.x,
                y: box.scale.y,
                z: box.scale.z,
            }
        }
    };


    // axix, xyz, action: scale, move, direction, up/down
    this.transform_bbox= function(command){
        if (!this.selected_box)
            return;
        
        switch (command){
            case 'x_move_up':
                this.boxOp.translate_box(this.selected_box, 'x', 0.05);
                break;
            case 'x_move_down':
                this.boxOp.translate_box(this.selected_box, 'x', -0.05);
                break;
            case 'x_scale_up':
                this.selected_box.scale.x *= 1.01;    
                break;
            case 'x_scale_down':
                this.selected_box.scale.x /= 1.01;
                break;
            
            case 'y_move_up':
                this.boxOp.translate_box(this.selected_box, 'y', 0.05);
                break;
            case 'y_move_down':        
                this.boxOp.translate_box(this.selected_box, 'y', -0.05);            
                break;
            case 'y_scale_up':
                this.selected_box.scale.y *= 1.01;    
                break;
            case 'y_scale_down':
                this.selected_box.scale.y /= 1.01;
                break;
            
            case 'z_move_up':
                this.selected_box.position.z += 0.05;
                break;
            case 'z_move_down':        
                this.selected_box.position.z -= 0.05;
                break;
            case 'z_scale_up':
                this.selected_box.scale.z *= 1.01;    
                break;
            case 'z_scale_down':
                this.selected_box.scale.z /= 1.01;
                break;
            
            case 'z_rotate_left':
                this.selected_box.rotation.z += 0.01;
                break;
            case 'z_rotate_right':
                this.selected_box.rotation.z -= 0.01;
                break;
            
            case 'z_rotate_reverse':        
                if (this.selected_box.rotation.z > 0){
                    this.selected_box.rotation.z -= Math.PI;
                }else{
                    this.selected_box.rotation.z += Math.PI;
                }    
                break;
            case 'reset':
                this.selected_box.rotation.x = 0;
                this.selected_box.rotation.y = 0;
                this.selected_box.rotation.z = 0;
                this.selected_box.position.z = 0;
                break;

        }
        this.on_box_changed(this.selected_box);
    };
    this.keydown=async function( ev ) {
        this.operation_state.key_pressed = true;
        switch ( ev.key) {
            case '+':
                this.data.scale_point_size(1.2);
                this.render();
                break;
            case '-':
                this.data.scale_point_size(0.8);
                this.render();
                break;
            case '[':
                this.select_previous_object();
                break;
            case ']':
                this.select_next_object();
                break;
            case 'PageUp':
                if (ev.shiftKey)
                    this.previous_scene()
                else
                    this.previous_frame();
                break;
            case 'PageDown':
                if (ev.shiftKey)
                    this.next_scene()
                else
                    this.next_frame();
                break;
            case 'P':
            case 'p':
                if (ev.shiftKey)
                    this.downloadWebglScreenShot();
                break;
            case 'C':
            case 'c':
                if (ev.ctrlKey)
                    this.autoAdjust.mark_bbox(this.selected_box);
                break;
            case 'Z':
            case 'z':
                if (ev.shiftKey)
                    this.viewManager.mainView.transform_control.showZ = !this.viewManager.mainView.transform_control.showZ;
                break;
            case 'X':
            case 'x':
                if (ev.shiftKey)
                    this.viewManager.mainView.transform_control.showX = !this.viewManager.mainView.transform_control.showX;
                break;
            case 'Y':
            case 'y':
                if(ev.shiftKey)
                    this.viewManager.mainView.transform_control.showY = ! this.viewManager.mainView.transform_control.showY;
                break;            
            case ' ': // Spacebar
                //this.viewManager.mainView.transform_control.enabled = ! this.viewManager.mainView.transform_control.enabled;
                this.playControl.pause_resume_play();
                break;
                
            case '5':            
            case '6':
            case '7':
                if (ev.shiftKey) {
                    this.boxEditor.boxView.views[ev.key - 5].cameraHelper.visible = !this.boxEditor.boxView.views[ev.key - 5].cameraHelper.visible;
                    this.render();
                }
                break;
            case 'S':
            case 's':
                if (ev.ctrlKey){
                    if (ev.shiftKey)
                        saveWorldList([this.data.world],true);
                    else
                        saveWorldList([this.data.world],false);
                }
                else if (ev.shiftKey && this.selected_box)
                {
                    let v = Math.max(this.editorCfg.moveStep * this.selected_box.scale.x, 0.02);
                    this.boxOp.translate_box(this.selected_box, 'x', -v);
                    this.on_box_changed(this.selected_box);
                }
                break;
            case 'W':
            case 'w':
                if (ev.shiftKey) {
                    if (this.selected_box) {
                        let v = Math.max(this.editorCfg.moveStep * this.selected_box.scale.x, 0.02);
                        this.boxOp.translate_box(this.selected_box, 'x', v);
                        this.on_box_changed(this.selected_box);
                    }
                }
                break;
            case 'A':
            case 'a':
                if (ev.shiftKey) {
                    if (this.selected_box) {
                        let v = Math.max(this.editorCfg.moveStep * this.selected_box.scale.y, 0.02);
                        this.boxOp.translate_box(this.selected_box, 'y', v);
                        this.on_box_changed(this.selected_box);
                    }
                }
                break;
            case 'D':
            case 'd':
                if (ev.shiftKey) {
                    if (this.selected_box) {
                        let v = Math.max(this.editorCfg.moveStep * this.selected_box.scale.y, 0.02);
                        this.boxOp.translate_box(this.selected_box, 'y', -v);
                        this.on_box_changed(this.selected_box);
                    }
                }
                break;
            case 'Q':
            case 'q':
                if (ev.shiftKey) {
                    if (this.selected_box) {
                        this.boxOp.rotate_z(this.selected_box, this.editorCfg.rotateStep, false);
                        this.on_box_changed(this.selected_box);
                    }
                }
                break;
            case 'E':
            case 'e':
                if (ev.shiftKey) {
                    if (this.selected_box) {
                        this.boxOp.rotate_z(this.selected_box, -this.editorCfg.rotateStep, false);
                        this.on_box_changed(this.selected_box);
                    }
                }
                break;
            case 'R':
            case 'r':
                if (ev.shiftKey) {
                    if (this.selected_box) {
                        //this.transform_bbox("z_rotate_left");
                        this.boxOp.rotate_z(this.selected_box, this.editorCfg.rotateStep, true);
                        this.on_box_changed(this.selected_box);
                    }
                }
                break;
            case 'F':
            case 'f':
                if (ev.shiftKey) {
                    if(ev.ctrlKey)
                        await this.tracker.track(this.data.world.frameInfo.scene,this.data.world.frameInfo.frame_index);
                    else{
                        if (this.selected_box) {
                            this.boxOp.rotate_z(this.selected_box, -this.editorCfg.rotateStep, true);
                            this.on_box_changed(this.selected_box);
                        }
                    }

                }
                break;
            case 'G':
            case 'g':
                if (ev.shiftKey)
                    this.transform_bbox("z_rotate_reverse");
                break;
            case 'T':
            case 't':
                if (ev.shiftKey)
                    this.showTrajectory();
                break;
            case 'V':
            case 'v':
                if (ev.ctrlKey){
                    if(!ev.shiftKey){
                        let box = this.add_box_on_mouse_pos_by_ref();
                        this.on_box_changed(box);
                    }
                    else{
                        let box = this.add_box_on_mouse_pos_by_global();
                        this.on_box_changed(box);
                    }
                }
                else if(ev.shiftKey)
                    this.enterBatchEditMode();
                break;
            case 'Delete':
                this.remove_selected_box();
                this.header.updateModifiedStatus();
                break;
            case 'Escape':
                if (this.selected_box)
                    this.unselectBox(null);
                break;
        }
    };
    this.previous_scene=async function(){
        const this_scenename = this.data.world.frameInfo.scene;
        let num = this_scenename.match(/\d+/g);
        if(!this_scenename || !num)
            return;
        num--;
        let create_time = new Date().getTime();
        let sceneName = "nusc"+num.toString();
        var meta = this.data.getMetaBySceneName(sceneName);
        if (!meta)
            meta = await this.data.readSceneMetaData(sceneName);
        if (!meta)
            return;
        if (meta.camera)
            this.imageContextManager.updateCameraList(meta.camera);
        if(sceneName.substring(0,4)=="nusc"){
            if(meta.is_key_frame[0])
                document.getElementById("show-keyframe").innerHTML = "Keyframe:"+meta.frames[-1]+"&nbsp&nbsp";
            else
                document.getElementById("show-keyframe").innerHTML = "Nonkeyframe:"+meta.frames[-1]+"&nbsp&nbsp";
        }
        let frame = meta.frames[0];
        objIdManager.setCurrentScene(sceneName);

        await this.load_world(sceneName, frame);
        let finish_time = new Date().getTime();
        console.log(finish_time, sceneName, frame, "loaded in ", finish_time - create_time, "ms");
    }
    this.next_scene=async function(){
        const this_scenename = this.data.world.frameInfo.scene;
        let num = this_scenename.match(/\d+/g)
        if(!this_scenename || !num)
            return;
        num++;
        let create_time = new Date().getTime();
        let sceneName = "nusc"+num.toString();
        var meta = this.data.getMetaBySceneName(sceneName);
        if (!meta)
            meta = await this.data.readSceneMetaData(sceneName);
        if (!meta)
            return;
        if (meta.camera)
            this.imageContextManager.updateCameraList(meta.camera);
        if(sceneName.substring(0,4)=="nusc"){
            if(meta.is_key_frame[0])
                document.getElementById("show-keyframe").innerHTML = "Keyframe:"+meta.frames[0]+"&nbsp&nbsp";
            else
                document.getElementById("show-keyframe").innerHTML = "Nonkeyframe:"+meta.frames[0]+"&nbsp&nbsp";
        }
        let frame = meta.frames[0];
        objIdManager.setCurrentScene(sceneName);

        await this.load_world(sceneName, frame);
        let finish_time = new Date().getTime();
        console.log(finish_time, sceneName, frame, "loaded in ", finish_time - create_time, "ms");
    }
    this.previous_frame= function(){
        if (!this.data.meta)
            return;
        var scene_meta = this.data.get_current_world_scene_meta();
        var frame_index = this.data.world.frameInfo.frame_index-1;
        if (frame_index < 0){
            // console.log("first frame");
            this.infoBox.show("Notice", "This is the first frame");
            return;
        }
        this.load_world(scene_meta.scene, scene_meta.frames[frame_index]);
        if(this.data.world.frameInfo.scene.substring(0,4)=="nusc"){
            let meta =scene_meta;
            if(meta.is_key_frame[frame_index])
                document.getElementById("show-keyframe").innerHTML = "Keyframe:"+meta.frames[frame_index]+"&nbsp&nbsp";
            else
                document.getElementById("show-keyframe").innerHTML = "Nonkeyframe:"+meta.frames[frame_index]+"&nbsp&nbsp";
        }
    };
    this.last_frame = function()
    {
        let scene_meta = this.data.get_current_world_scene_meta();
        this.load_world(scene_meta.scene, scene_meta.frames[scene_meta.frames.length-1]);
        if(this.data.world.frameInfo.scene.substring(0,4)=="nusc"){
            let meta =scene_meta;
            let frame_index = scene_meta.frames.length-1;
            if(meta.is_key_frame[frame_index])
                document.getElementById("show-keyframe").innerHTML = "Keyframe:"+meta.frames[frame_index]+"&nbsp&nbsp";
            else
                document.getElementById("show-keyframe").innerHTML = "Nonkeyframe:"+meta.frames[frame_index]+"&nbsp&nbsp";
        }
    };
    this.first_frame = function()
    {
        let scene_meta = this.data.get_current_world_scene_meta();
        this.load_world(scene_meta.scene, scene_meta.frames[0]);
        if(this.data.world.frameInfo.scene.substring(0,4)=="nusc"){
            let meta =scene_meta;
            let frame_index = 0;
            if(meta.is_key_frame[frame_index])
                document.getElementById("show-keyframe").innerHTML = "Keyframe:"+meta.frames[frame_index]+"&nbsp&nbsp";
            else
                document.getElementById("show-keyframe").innerHTML = "Nonkeyframe:"+meta.frames[frame_index]+"&nbsp&nbsp";
        }
    };

    this.next_frame= function(){
        if (!this.data.meta)
            return;
        var scene_meta = this.data.get_current_world_scene_meta();
        var num_frames = scene_meta.frames.length;
        var frame_index = (this.data.world.frameInfo.frame_index +1);
        if (frame_index >= num_frames){
            // console.log("last frame");
            this.infoBox.show("Notice", "This is the last frame");
            return;
        }
        this.load_world(scene_meta.scene, scene_meta.frames[frame_index]);
        if(this.data.world.frameInfo.scene.substring(0,4)=="nusc"){
            let meta =scene_meta;
            if(meta.is_key_frame[frame_index])
                document.getElementById("show-keyframe").innerHTML = "Keyframe:"+meta.frames[frame_index]+"&nbsp&nbsp";
            else
                document.getElementById("show-keyframe").innerHTML = "Nonkeyframe:"+meta.frames[frame_index]+"&nbsp&nbsp";
        }
        // console.log(scene_meta.frames[frame_index]);
    };

    this.select_next_object= function(){

        var self=this;
        if (this.data.world.annotation.boxes.length<=0)
            return;

        if (this.selected_box){
            this.operation_state.box_navigate_index = this.data.world.annotation.boxes.findIndex(function(x){
                return self.selected_box == x;
            });
        }
        
        this.operation_state.box_navigate_index += 1;            
        this.operation_state.box_navigate_index %= this.data.world.annotation.boxes.length;    
        
        this.selectBox(this.data.world.annotation.boxes[this.operation_state.box_navigate_index]);

    };

    this.select_previous_object= function(){
        var self=this;
        if (this.data.world.annotation.boxes.length<=0)
            return;

        if (this.selected_box){
            this.operation_state.box_navigate_index = this.data.world.annotation.boxes.findIndex(function(x){
                return self.selected_box == x;
            });
        }
        
        this.operation_state.box_navigate_index += this.data.world.annotation.boxes.length-1;            
        this.operation_state.box_navigate_index %= this.data.world.annotation.boxes.length;    
        
        this.selectBox(this.data.world.annotation.boxes[this.operation_state.box_navigate_index]);
    };


    this.on_load_world_finished= function(world){

        document.title = "SUSTech POINTS-" + world.frameInfo.scene;
        // switch view positoin
        this.moveAxisHelper(world);
        this.moveRangeCircle(world);
        this.lookAtWorld(world);
        this.unselectBox(null, true);
        this.unselectBox(null, true);
        this.render();
        this.imageContextManager.attachWorld(world);
        this.imageContextManager.render_2d_image();
        this.render2dLabels(world);
        this.update_frame_info(world.frameInfo.scene, world.frameInfo.frame);


        this.select_locked_object();

        // preload after the first world loaded
        // otherwise the loading of the first world would be too slow
        this.data.preloadScene(world.frameInfo.scene, world);
    };
    this.moveAxisHelper = function(world) {
        world.webglGroup.add(this.axis);
    };

    this.mainViewOffset = [0,0,0];

    this.lookAtWorld = function(world){
        let newOffset = [
                world.coordinatesOffset[0] - this.mainViewOffset[0],
                world.coordinatesOffset[1] - this.mainViewOffset[1],
                world.coordinatesOffset[2] - this.mainViewOffset[2],
            ];
        
        this.mainViewOffset = world.coordinatesOffset;
        
        this.viewManager.mainView.orbit.target.x += newOffset[0];
        this.viewManager.mainView.orbit.target.y += newOffset[1];
        this.viewManager.mainView.orbit.target.z += newOffset[2];

        this.viewManager.mainView.camera.position.x += newOffset[0];
        this.viewManager.mainView.camera.position.y += newOffset[1];
        this.viewManager.mainView.camera.position.z += newOffset[2];

        this.viewManager.mainView.orbit.update();
        
    };

    this.load_world = async function(sceneName, frame, onFinished){
        this.data.dbg.dump();
        var self=this;
        //stop if current world is not ready!
        // if (this.data.world && !this.data.world.preloaded()){
        //     this.infoBox.show("Error!","current world is still loading.");
        //     return;
        // }

        if (this.selected_box && this.selected_box.in_highlight)
            this.cancelFocus(this.selected_box);


        if (this.viewManager.mainView && this.viewManager.mainView.transform_control.visible)
            //unselect first time
            this.viewManager.mainView.transform_control.detach();

        var world = await this.data.getWorld(sceneName, frame);
        if (world)
        {
            this.data.activate_world(
                world, 
                function(){
                    self.on_load_world_finished(world);
                    if (onFinished)
                        onFinished();
                    
                }
            );
        }

        
    };

    this.remove_box = function(box, render=true){
        if (box == this.selected_box){
            this.unselectBox(null,true);
            this.unselectBox(null,true); //twice to safely unselect.
            this.selected_box = null;
            //this.remove_selected_box();
        }
        this.do_remove_box(box, false); // render later.
        // this should be after do-remove-box
        // subview renderings don't need to be done again after
        // the box is removed.
        if (box.boxEditor)
        {
            if (box.boxEditor){
                box.boxEditor.detach("donthide");
            }
            else{
                console.error("what?");
            }
        }
        this.header.updateModifiedStatus();
        if (render)
            this.render();
    };

    this.remove_selected_box= function(){
        this.remove_box(this.selected_box);
    };

    this.do_remove_box = function(box, render=true){
        if(!box)
            return;
        if (!box.annotator || box.annotator=='t')
            this.restore_box_points_color(box, render);
        this.imageContextManager.boxes_manager.remove_box(box.obj_local_id);
        this.floatLabelManager.remove_box(box);
        this.fastToolBox.hide();
        this.tracker.update_box(box.world.frameInfo.frame,box,"delete");
        objIdManager.delObject({category: box.obj_type,id: box.obj_track_id});
        box.world.annotation.unload_box(box);
        box.world.annotation.remove_box(box);
        box.world.annotation.setModified();
    },

    this.clear= function(){

        this.header.clear_box_info();
        //this.editorUi.querySelector("#image").innerHTML = '';
        this.unselectBox(null);
        this.unselectBox(null);
        this.header.clear_frame_info();
        this.imageContextManager.clear_main_canvas();
        this.boxEditor.detach();
        this.data.world.unload();
        this.data.world= null; //dump it
        this.floatLabelManager.remove_all_labels();
        this.fastToolBox.hide();
        this.render();
    };

    this.update_frame_info= function(scene, frame){
        const self = this;
        this.header.set_frame_info(scene, frame, function(sceneName){
            self.scene_changed(sceneName)});
    };

    this.get_box_velocity = function(lastbox,box,nextbox){
        if(!lastbox && !nextbox){
            if(box.velocity)
                return box.velocity;
            else
                return[999,999];
        }
        let lastpos = lastbox?lastbox.globalpsr:box.globalpsr;
        let nextpos = nextbox?nextbox.globalpsr:box.globalpsr;
        let pos_diff = [nextpos.position.x-lastpos.position.x,nextpos.position.y-lastpos.position.y];
        let time_diff =(nextbox?nextbox.timestamp:box.timestamp)- (lastbox?lastbox.timestamp:box.timestamp);
        return [pos_diff[0]/time_diff,pos_diff[1]/time_diff];
    }

    this.change_box_velocity = function(box){
        let lastworld = box.world.data.worldList.find(w=>w.frameInfo.scene==box.world.frameInfo.scene&&
            w.frameInfo.frame_index==box.world.frameInfo.frame_index-1);
        let lastbox =lastworld?lastworld.annotation.findBoxByTrackId(box.obj_track_id):null;
        let nextworld = box.world.data.worldList.find(w=>w.frameInfo.scene==box.world.frameInfo.scene&&
            w.frameInfo.frame_index==box.world.frameInfo.frame_index+1);
        let nextbox = nextworld?nextworld.annotation.findBoxByTrackId(box.obj_track_id):null;
        let next2world = box.world.data.worldList.find(w=>w.frameInfo.scene==box.world.frameInfo.scene&&
            w.frameInfo.frame_index==box.world.frameInfo.frame_index+2);
        let next2box = next2world?next2world.annotation.findBoxByTrackId(box.obj_track_id):null;
        let last2world = box.world.data.worldList.find(w=>w.frameInfo.scene==box.world.frameInfo.scene&&
            w.frameInfo.frame_index==box.world.frameInfo.frame_index-2);
        let last2box = last2world?last2world.annotation.findBoxByTrackId(box.obj_track_id):null;

        box.velocity = this.get_box_velocity(lastbox,box,nextbox);
        if(lastbox)
            lastbox.velocity = this.get_box_velocity(last2box,lastbox,box);
        if(nextbox)
            nextbox.velocity = this.get_box_velocity(box,nextbox,next2box);

    }


    this.on_box_changed = function(box){
        let globalpos = box.world.lidarPosToUtm(box.position);
        let globalrot = box.world.lidarRotToUtm(box.rotation);
        box.globalpsr = {position:{x:globalpos.x,y:globalpos.y,z:globalpos.z},
            rotation:{x:globalrot.x,y:globalrot.y,z:globalrot.z}};
        this.change_box_velocity(box);
        window.editor.tracker.update_box(box.world.frameInfo.frame,box,"modify");


        if (!this.imageContextManager.hidden())
            this.imageContextManager.boxes_manager.update_box(box);

        this.header.update_box_info(box);
        //floatLabelManager.update_position(box, false);  don't update position, or the ui is annoying.
        box.world.annotation.setModified();

        this.updateBoxPointsColor(box);
        this.save_box_info(box);

        if (box.boxEditor)
            box.boxEditor.onBoxChanged();

        this.autoAdjust.syncFollowers(box);

        if (box.on_box_changed)
            box.on_box_changed();

        this.header.updateModifiedStatus();
        this.render();
    };

    // box removed, restore points color.
    this.restore_box_points_color= function(box,render=true){
        if (this.data.cfg.color_obj != "no"){
            box.world.lidar.reset_box_points_color(box);
            box.world.lidar.update_points_color();
            if (render)
                this.render();
        }
        
    };

    this.updateBoxPointsColor= function(box){
        if (this.data.cfg.color_obj != "no"){
            if (box.last_info){
                box.world.lidar.set_box_points_color(box.last_info, {x: this.data.cfg.point_brightness, y: this.data.cfg.point_brightness, z: this.data.cfg.point_brightness});
            }
            box.world.lidar.set_box_points_color(box);
            box.world.lidar.update_points_color();            
        }
    };

    this.onSelectedBoxChanged= function(box){
        if (box){        
            this.header.update_box_info(box);
            this.imageContextManager.boxes_manager.onBoxSelected(box.obj_local_id, box.obj_type);
            this.render();
        } else
            this.header.clear_box_info();

    };

    this.render2dLabels= function(world){
        if (this.editorCfg.disableMainView)
            return;

        this.floatLabelManager.remove_all_labels();
        var self=this;
        world.annotation.boxes.forEach(function(b){
            self.floatLabelManager.add_label(b);
        })

        if (this.selected_box){
            //this.floatLabelManager.select_box(this.selected_box.obj_local_id)
            this.fastToolBox.show();
            this.fastToolBox.setValue(this.selected_box.obj_type, this.selected_box.obj_track_id, this.selected_box.obj_attr);
        }
    };

    this.add_global_obj_type= function(){

        var self = this;
        var sheet = window.document.styleSheets[1];
        let scenename = this.editorUi.querySelector("#scene-input").value;
        let obj_type_map = null
        if(scenename.substring(0,4) == "nusc")
            obj_type_map = globalObjectCategory.nusc_obj_type_map;
        else
            obj_type_map = globalObjectCategory.obj_type_map;

        for (var o in obj_type_map){
            var rule = '.'+o+ '{color:'+obj_type_map[o].color+';'+ 
                                'stroke:' +obj_type_map[o].color+ ';'+
                                'fill:' +obj_type_map[o].color+ '22' + ';'+
                                '}';
            sheet.insertRule(rule, sheet.cssRules.length);
        }

        function color_str(v){
            let c =  Math.round(v*255);
            if (c < 16)
                return "0" + c.toString(16);
            else
                return c.toString(16);
        }

        for (let idx=0; idx<=32; idx++){
            let c = globalObjectCategory.get_color_by_id(idx);
            let color = "#" + color_str(c.x) + color_str(c.y) + color_str(c.z);

            var rule = '.color-'+idx+ '{color:'+color+';'+ 
                                'stroke:' +color+ ';'+
                                'fill:' +color+ '22' + ';'+
                                '}';
            sheet.insertRule(rule, sheet.cssRules.length);
        }

        // obj type selector
        var options = "";
        for (var o in obj_type_map){
            options += '<option value="'+o+'" class="' +o+ '">'+o+ '</option>';        
        }

        this.editorUi.querySelector("#floating-things #object-category-selector").innerHTML = options;
        //this.editorUi.querySelector("#batch-editor-tools-wrapper #object-category-selector").innerHTML = options;

        // submenu of new
        var items = "";
        for (var o in obj_type_map){
            items += '<div class="menu-item cm-new-item ' + o + '" id="cm-new-'+o+'" uservalue="' +o+ '"><div class="menu-item-text">'+o+ '</div></div>';        
        }

        this.editorUi.querySelector("#new-submenu").innerHTML = items;

        this.contextMenu.installMenu("newSubMenu", this.editorUi.querySelector("#new-submenu"), (event)=>{
            let obj_type = event.currentTarget.getAttribute("uservalue");
            let box = self.add_box_on_mouse_pos(obj_type);
            let noscaling = event.shiftKey;
            self.boxOp.auto_rotate_xyz(box, null, null, function(b){
                self.on_box_changed(b);
            }, noscaling);
            return true;
        });
    };

    this.onAnnotationUpdatedByOthers = function(scene, frames){
        this.data.onAnnotationUpdatedByOthers(scene, frames);
    }

    this.init(editorUi);

};

export{Editor}