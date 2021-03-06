if(typeof require=="function" && typeof EventEmitter=="undefined"){
	EventEmitter=require('events').EventEmitter;
}

//外部へ情報を送れるやつ
var gaminginfo=new EventEmitter;

function Game(){
	this.config=Game.util.clone(this.defaultConfig);
	this.gaminginfo=gaminginfo;
	this.idGenerator=new IDGenerator();
	
	this.event=new EventEmitter();
	this.transport=this.getTransporter();

	this.objects=[];	//brain objects
	
	this.delays=[];	//{remains:frame, func:()}
	
	this.store={};	//データストア（Server用）
	//ユーザー
	this.defaultUser=Game.User;
	this._users=[];	//参加ユーザーの一覧
	this.userfunc=null;	//ユーザー初期化時に呼び出す関数
	//なんかのマネージャ
	this.manager=new Game.Manager(this);
	//できた
	gaminginfo.emit("new",this);

	//オブジェクトストア（本当はWeakMapがいい）
	this.objectsmap={};

	this.internal_init();
}
Game.util={
	clone:function(obj){
		if(typeof obj!=="object" || !obj)return obj;

		var result=Object.create(Object.getPrototypeOf(obj));
		var arr=Object.getOwnPropertyNames(obj), l=arr.length;
		for(var i=0;i<l;i++){
			Object.defineProperty(result,arr[i],Object.getOwnPropertyDescriptor(obj,arr[i]));
		}
		return result;
	},
	merge:function(base,obj){
		var result=this.clone(base);
		if(!obj)return result;
		var arr=Object.getOwnPropertyNames(obj), l=arr.length;
		for(var i=0;i<l;i++){
			Object.defineProperty(result,arr[i],Object.getOwnPropertyDescriptor(obj,arr[i]));
		}
		return result;
	},
	extend:function(base,obj){
		var result=Object.create(base.prototype);
		if(!obj)return result;
		var arr=Object.getOwnPropertyNames(obj), l=arr.length;
		for(var i=0;i<l;i++){
			Object.defineProperty(result,arr[i],Object.getOwnPropertyDescriptor(obj,arr[i]));
		}
		return result;
	},
	//----------------
	//配列をシャッフル
	shuffleArray:function(arr){
		var l=arr.length;
		while(l){
			var i=Math.floor(Math.random()*l);
			var one=arr[--l];	//最後の
			//入れ替え
			arr[l]=arr[i];
			arr[i]=one;
		}
		return arr;
	},
};


Game.prototype={
	internal_init:function(){
	},
//新しいIDを作る
	uniqueId:function(){
		return this.idGenerator.generate();
	},
	init:function(view,viewparam){
		//hard
		this.view = new view(this);
		this.view.init(viewparam);
	},
	start:function(){
		//hard
		//var user=new Game.User();
		var user=this.newUser();
		this.user=user;
		this.event.emit("gamestart");
		this.view.event.emit("gamestart");
		this.entry(user,{});
	},
	//ユーザーが登録された
	entry:function(user,opt){
		this._users.push(user);
		this.manager.newUser(user);
		this.event.emit("entry",user,opt);
	},
	//ユーザーがいなくなった
	byeUser:function(user){
		this._users=this._users.filter(function(x){return x!=user});
		this.manager.bye(user);
	},
	newUser:function(option){
		if(!option)option={};
		var user=new (this.defaultUser)();
		//ユーザーに対してIDを付加
		Object.defineProperty(user,"_id",{
			value:this.uniqueId()
		});
		this.objectsmap[user._id]=user;
		user.init(this,option);
		if(this.userfunc)this.userfunc(user);
		return user;
	},
	useUser:function(userobj,userfunc){
		this.defaultUser=userobj;
		this.userfunc=userfunc;
	},
	getTransporter:function(){
		return new (this.transporter)(this,this.gaminginfo);
	},
	//start loop
	loop:function(){
		
		this.manager=new Game.LoopManager(this);
		this.manager.start();
		//オブジェクト削除部分上書き
		this._eraceObject=this._loop_eraceObject;
	},
	//main loop
	mainloop:function(){
		var arr=this.objects;
		this.view.event.emit("loop",arr);
		for(var i=0,l=arr.length;i<l;i++){
			var ins=arr[i].event;
			ins.emit("internal");
			ins.emit("loop");
			
			if(arr[i]._flg_dying){
				this.transport.die(arr[i]);
				arr.splice(i,1);
				i--,l--;
			}
		}
		//delayの処理
		arr=this.delays;
		for(i=0,l=arr.length;i<l;i++){
			var o=arr[i];
			if(o.cond && !o.cond()){
				arr.splice(i,1);
				i--,l=arr.length;
				continue;
			}
			if(--o.remains <= 0){
				o.func();
				arr.splice(i,1);
				i--,l=arr.length;
			}
		}
		this.transport.loop();
	},
	
	//なんのEmitterを使うか
	getObjectEmitter:function(obj){
		return new Game.ObjectEmitter(this,obj);
	},
	//objects return:internal object
	add:function(constructor,param,_rerender_flg){
		//_rerender_flg: trueならレンダリングしない
		if(typeof constructor!=="function"){
			throw new Error;
		}
		if(!param)param={};
		
		//通知イベント
		//var instance = new EventEmitter();
		var instance;
		
		var datastore=Game.util.clone(param);
		var t=this;
		
		//var d=new constructor(this,instance,datastore,this.view);
		/*var d = (function(){
			f.prototype=constructor.prototype;
			return new f;
			function f(){
				instance = t.getObjectEmitter(this);
				constructor.call(this, t,instance,datastore,t.view);
			}
		})();*/
		var d=Object.create(constructor.prototype);
		var instance=this.getObjectEmitter(d);
		
		//d.event = instance;
		Object.defineProperty(d,"event",{
			value:instance,
		});
		//コンストラクタを保存
		Object.defineProperty(d,"_constructor",{
			value:constructor,
		});
		//パラメータを保存
		Object.defineProperty(d,"_param",{
			value:Game.util.clone(param),
		});
		
		//constructor.call(d,this,instance,datastore,this.view);
		this.initObject(d);

		if(d._id)this.objectsmap[d._id]=d;

		this.objects.push(d);
		this.transport.add(d);
		if(!_rerender_flg)this.view.event.emit("rerender");
		return d;
	},
	initObject:function(d){
		d._id=this.uniqueId();
		d.event.on("die",function(){
			//d._flg_dying=true;	//dying flag
			this._eraceObject(d);
		}.bind(this));
		//dはまだコンストラクタ関数を読んでいない（Object.createで作られた）
		d._constructor.call(d,this,d.event,d._param,this.view);
		//initしてあげる
		if(d.init)d.init(this,d.event,d._param,this.view);
	},
	_eraceObject:function(obj,i){
		i = i==null ? this.objects.indexOf(obj) : i;
		this.transport.die(obj);
		this.objects.splice(i,1);
	},
	_loop_eraceObject:function(obj,i){
		obj._flg_dying=true;
	},

	
	//for internal loop
	filter:function(func){
		return this.objects.filter(function(x){return x instanceof func});
	},
	//一つ
	random:function(func){
		var arr=this.filter(func);
		if(arr.length==0)return null;
		return arr[Math.floor(Math.random()*arr.length)];
	},
	//数える
	count:function(func){
		return this.filter(func).length;
	},
	//全部削除（からっぽ）
	clean:function(){
		//this.objects.length=0;
		this.objectsmap={};
		var arr=this.objects.concat([]);
		for(var i=0,l=arr.length;i<l;i++){
			this._eraceObject(arr[i]);
		}
		//this.transport.clean();
	},
	//そのオブジェクトがまだ存在しているかどうか
	alive:function(obj){
		return this.objects.indexOf(obj)>=0;
	},
	
	//関数登録
	delay:function(time,func){
		this.delays.push({
			remains:time,
			func:func,
		});
	},
	delaywhile:function(time,cond,func){
		//cond()がfalseを返した場合delayを中断する
		this.delays.push({
			remains:time,
			cond:cond,
			func:func,
		});
	},
	//ストッパーつき関数登録
	delaystopper:function(time,func){
		this.delay(time,func);
		return function(){
			var d=this.delays;
			for(var i=0,l=d.length;i<l;i++){
				if(d[i].func===func){
					d.splice(i,1);
					break;
				}
			}
		};
	},
	//event
	//ユーザーのセッションを保持させる
	//option: expire:[s] 有効期限
	session:function(user,option){
	},
	//セッションを解除
	unsession:function(user){
	},
	//internalのみ実行
	internal:function(callback){
		callback();
	},
	//------------------
	defaultConfig:{
		fps:30,
		adjust:5,
		stopWithNoUser:true,
	},
	//環境 単体動作中なら"standalone" サーバーから"server" クライアントなら"client"
	env:"standalone",
};
//オブジェクト用Emitter
Game.ObjectEmitter=function(game,obj){
	EventEmitter.apply(this,arguments);
	this.game=game;
	this.obj=obj;	//対応するオブジェクトがある
};
Game.ObjectEmitter.prototype=Game.util.extend(EventEmitter,{
	/*_emit:function(){
		EventEmitter.prototype.emit.apply(this,arguments);
	},*/
	emit:function(){
		EventEmitter.prototype.emit.apply(this,arguments);
		if(arguments[0]==="newListener")return;
		this.game.view.event.emit("f5",this.obj);
	},
	//内部用on?
	//internal:function(){this.on.apply(this,arguments)},
});

Game.View=function(game){
	this.game=game;
	this.event=new EventEmitter();
	//this.server=false;	//サーバーサイドかどうか
};
Game.View.prototype={
	init:function(param){
		var ev=this.event;
		ev.on("loop",this.mainloop.bind(this));
	},
	mainloop:function(objects){
		//main loop
		/*for(var i=0,l=instances.length;i<l;i++){
			instances[i].emit("draw");
		}*/
	},
};

Game.ClientView=function(){
	Game.View.apply(this,arguments);
};
Game.ClientView.prototype=Game.util.merge(new Game.View,{
	mainloop:function(objects){
		//override main loop
		this.render(objects);
	},
	render:function(objects){
	},
});
Game.ClientCanvasView=function(){
	Game.ClientView.apply(this,arguments);
};
Game.ClientCanvasView.prototype=Game.util.merge(new Game.ClientView,{
	init:function(param){
		Game.ClientView.prototype.init.apply(this,arguments);
		
		var c=this.canvas=document.createElement("canvas");
		c.width=param.width, c.height=param.height;
		
		var wrapper=document.createElement("div");
		wrapper.appendChild(c);
		document.body.appendChild(wrapper);
	},
	render:function(objects){
		var c=this.canvas, ctx=c.getContext('2d');
		ctx.clearRect(0,0,c.width,c.height);
		for(var i=0,l=objects.length;i<l;i++){
			//objects[i].event.emit("render",c,ctx);
			if(objects[i].render)objects[i].render(c,ctx);
		}
	},
});
Game.ClientDOMView=function(){
	Game.ClientView.apply(this,arguments);
	//body直下に描画するべきもの
	this.toprenders=[];
};
Game.ClientDOMView.prototype=Game.util.extend(Game.ClientView,{
	init:function(param){
		Game.ClientView.prototype.init.apply(this,arguments);
		this.nodeMap={};	//_idをキーにしたい
		/*(_id):{
		  node:(Node)
		  dependency:[obj,obj,...]
		}*/
		this.stack=[];	//現在のオブジェクト
		this.stacktop=null;
		var ev=this.event, t=this;;
		ev.on("gamestart",function(){
			t.rerender();
		});
		ev.on("rerender",function(){
			t.rerender();
		});
		//更新された
		ev.on("f5",function(obj){
			var mm=t.getMap(obj);
			mm.outdated=true;
			t.rerender();
		});
	},
	//トップレンダリング
	getTop:function(){
		//新しいのを探す
		var arr=game.objects.filter(function(x){return x.renderTop});
		this.toprenders=arr;
		return this.toprenders;
	},
	//走査して書き直す
	rerender:function(){
		//console.log("rerender");
		//debugger;
		var t=this.getTop();
		//hard
		while(document.body.hasChildNodes()){
			document.body.removeChild(document.body.firstChild);
		}
		t.forEach(function(o){
			this.render(o);
			var m=this.getMap(o);
			document.body.appendChild(m.node);
		},this);
	},

	//スタック関連
	_addStack:function(obj){
		this.stack.push(obj);
		this.stacktop=obj;
	},
	_popStack:function(){
		var o=this.stack.pop();
		this.stacktop=this.stack[this.stack.length-1];
		return o;
	},
	getMap:function(obj){
		if(!obj)debugger;
		var m=this.nodeMap[obj._id];
		if(!m){
			m=this.nodeMap[obj._id]={
				node:null,
				dependency:[],
				outdated:true,	//リレンダリングが必要
			};
		}
		return m;
	},

	//そのオブジェクトが再描画必要か
	isOutdated:function(obj){
		var mm=this.getMap(obj);
		if(mm.outdated)return true;
		if(mm.dependency.length>0){
			return mm.dependency.some(function(x){return this.isOutdated(x)},this);
		}
		return false;
	},
	//そのオブジェクト
	render:function(obj){
		var mm=this.getMap(obj);
		if(this.stacktop){
			//そのオブジェクトに依存する
			var m=this.getMap(this.stacktop);
			//そのオブジェクトに依存している
			m.dependency.push(obj);
		}
		if(!this.isOutdated(obj)){
			return mm.node;
		}

		this._addStack(obj);
		//レンダリングしてもらう
		mm.dependency=[];	//依存関係初期化
		if(!obj.render){
			//レンダリングできない
			mm.node=document.createElement("span");
		}else{
			obj.render(this);
		}
		//レンダリング終了
		mm.outdated=false;
		this._popStack();
		return mm.node;
	},
	//描画しないけど依存している
	depend:function(obj){
		var mm=this.getMap(obj);
		if(this.stacktop){
			//そのオブジェクトに依存する
			var m=this.getMap(this.stacktop);
			//そのオブジェクトに依存している
			m.dependency.push(obj);
		}
	},
	//トップのノードを作る
	newItem:function(){
		var t=this.stacktop;
		if(!t)throw new Error("empty stack");
		var result=t.renderInit(this);
		var m=this.getMap(t);
		m.node=result;
		m.dependency=[];
		//識別データ（ほんとはWeakMapでやりたい）
		result.dataset._id=t._id;
		return result;
	},
	//トップのノードを得る
	getItem:function(){
		var t=this.stacktop;
		if(!t)throw new Error("empty stack");
		var m=this.getMap(t);
		var result;
		if(!m.node){
			result=this.newItem();
		}else{
			result=m.node;
		}
		return result;
	},
	//そのノードを含むかどうか
	isOwner:function(obj,node){
		var m=this.getMap(obj);
		if((node.compareDocumentPosition(m.node) & node.DOCUMENT_POSITION_CONTAINS)||(node===m.node)){
			//m.nodeがnodeを含む場合
			return true;
		}
		return false;
	},
	//そのノードかどうか
	isOwnerExact:function(obj,node){
		var m=this.getMap(obj);
		return m.node===node;
	},
});

//User input
Game.User=function(){
	this.event=new EventEmitter();
	this.internal=true;	//内部フラグ
	this.alive=true;	//まだ生存しているかどうか
	this.game=null;
};
Game.User.prototype={
	init:function(game){
		this.game=game;
	},
};
Game.DummyUser=function(){
	this.event=new EventEmitter();
};
Game.ClientUser=function(){
	Game.User.apply(this,arguments);
};
Game.ClientUser.prototype=Game.util.extend(Game.User,{
});
Game.KeyboardUser=function(){
	Game.ClientUser.apply(this,arguments);
};
Game.KeyboardUser.prototype=Game.util.extend(Game.ClientUser,{
	init:function(){
		Game.ClientUser.prototype.init.apply(this,arguments);

		//var ev=this.event=new EventEmitter();
		var ev=this.event;
		
		this.waitingkey=[];
		if(this.internal){
			//キーイベント定義
			document.addEventListener('keydown',function(e){
				if(this.waitingkey.indexOf(e.keyCode)>=0){
					ev.emit('keydown',{
						keyCode:e.keyCode,
					});
					e.preventDefault();
				}
			}.bind(this),false);
			document.addEventListener('keyup',function(e){
				if(this.waitingkey.indexOf(e.keyCode)>=0){
					ev.emit('keyup',{
						keyCode:e.keyCode,
					});
				}
			}.bind(this),false);
		}
	},
	keyWait:function(arr){
		this.waitingkey=arr;
	},
});
//DOM操作のユーザー。DOMViewとセットで
Game.DOMUser=function(){
	Game.ClientUser.apply(this,arguments);
};
Game.DOMUser.prototype=Game.util.extend(Game.ClientUser,{
	addEventListener:function(name,func,capture){
		if(!capture)capture=false;
		if(this.internal){
			document.addEventListener(name,func,capture);
		}
	},
	//ドラッグを検知できる
	ondrag:function(func){
		var game=this.game;
		//func(from_obj, to_obj);
		if(!this.internal)return;
		document.addEventListener("dragover",function(e){
			e.preventDefault();
		},false);
		//開始
		document.addEventListener("dragstart",function(e){
			var t=e.target;
			var obj=game.objectsmap[t.dataset._id];
			if(!obj)return;
			e.dataTransfer.items.add(t.dataset._id,"text/x-object_id");
		},false);
		document.addEventListener("drop",function(e){
			var t=e.target;
			//dropzoneを探す
			var node=t;
			while(node){
				if(node.dropzone)break;
				node=node.parentNode;
			}
			if(!node)return;
			var toobj=game.objectsmap[node.dataset._id];
			if(!toobj)return;
			//中身を見る
			var d=e.dataTransfer.items[0];
			if(!d)return;
			if(d.type=="text/x-object_id"){
				d.getAsString(function(obj_id){
					var fromobj=game.objectsmap[obj_id];
					if(!fromobj)return;
					func(fromobj,toobj);
				});
			}
		},false);
	},
});

//各種通信 基底クラス的なものを定義
Game.Transporter=function(game,gaminginfo){
}
Game.Transporter.prototype={
	add:function(obj){},
	die:function(obj){},
	clean:function(){},
	event:function(obj,name,args){},
	gameevent:function(name,args){},
	userevent:function(user,name,args){},
	loop:function(){},
};
Game.prototype.transporter=Game.Transporter;

Game.Manager=function(game){
	this.game=game;
};
Game.Manager.prototype={
	start:function(){},
	newUser:function(user){},
	bye:function(user){},
};
//ループ用
Game.LoopManager=function(game){
	Game.Manager.apply(this,arguments);
	this.usercount=0;
	this.stop_flg=true;
	this.ticktime=null;
};
Game.LoopManager.prototype={
	start:function(){
		var game=this.game, self=this;
		var ev=game.event;
		this.usercount=game._users.length;
		//ev.on("loop",this.mainloop.bind(this));
		ev.emit("loopstart");
		
		this.stop_flg=true;
		this.loopstart();
	},
	newUser:function(user){
		this.usercount++;
		this.loopstart();
	},
	loopstart:function(){
		if(!this.stop_flg || this.usercount===0)return;
		console.log("starting...");
		this.stop_flg=false;
		this.ticktime=Date.now();
		var t=this,game=this.game;
		var fps=game.config.fps;
		var ev=game.event;
		
		//時間カウント
		var frametime=1000/fps;
		var ticktime=Date.now();

		//main loop
		loop();
		function loop(){
			//ev.emit("loop");
			game.mainloop();
			var now=Date.now();
			var waitingtime=frametime-(now-ticktime);
			ticktime=ticktime+frametime;
			//console.log(waitingtime);
			if(!t.stop_flg){
				setTimeout(loop,waitingtime);	//loop
			}
		}
	},
	loopstop:function(){
		this.stop_flg=true;
		console.log("stopping...");
	},
	bye:function(user){
		this.usercount--;
		if(this.usercount===0)this.loopstop();
	},

}
function IDGenerator(){
	this.count=0;
}
IDGenerator.prototype.generate=function(){
	return this.count++;
};

if(typeof exports=="object" && exports){
	//exportできる
	exports.Game=Game;
	exports.gaminginfo=gaminginfo;
}
