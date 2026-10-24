import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,mkdir,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {WorkspaceGit} from "../src/git.mjs";

test("workspace Git commits only selected files, retains staged work and rejects unsafe inputs",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"paastacode-git-"))),git=new WorkspaceGit(root);
  const ceiling=process.env.GIT_CEILING_DIRECTORIES;process.env.GIT_CEILING_DIRECTORIES=join(root,"..");
  try{
    assert.equal((await git.status()).repository,false);
    await git.action({action:"init"});await git.call(["config","user.name","Synthetic tester"]);await git.call(["config","user.email","synthetic@example.test"]);
    await writeFile(join(root,"selected.txt"),"one\n");await writeFile(join(root,"other.txt"),"retain\n");await writeFile(join(root,".env"),"SYNTHETIC=local-only\n");
    await git.call(["add","--","other.txt"]);
    await git.action({action:"commit",message:"Selected change",paths:["selected.txt"]});
    assert.equal((await git.call(["show","HEAD:selected.txt"])).output,"one\n");
    assert((await git.status()).files.some(f=>f.path==="other.txt"&&f.status.startsWith("A")),"Unrelated staged files must stay staged");
    assert.equal(await readFile(join(root,"other.txt"),"utf8"),"retain\n");
    await assert.rejects(git.action({action:"commit",message:"deny secrets",paths:[".env"]}));
    await assert.rejects(git.action({action:"commit",message:"deny traversal",paths:["../outside"]}));
    for(const url of ["https://token@github.com/team/repo","https://a:b@github.com/team/repo","file:///tmp/repo","-evil","ssh://user:secret@example.test/repo"]){await assert.rejects(git.action({action:"remote",url}));}
    await git.action({action:"remote",url:"git@github.com:synthetic/repository.git"});
    assert.deepEqual((await git.status()).remotes,["origin"]);
    await assert.rejects(git.action({action:"branch",branch:"--force",create:true}));
    await git.action({action:"branch",branch:"codex/test",create:true});assert.equal((await git.status()).branch,"codex/test");
    await writeFile(join(root,"selected.txt"),"two\n");assert.match((await git.diff("selected.txt")).text,/\+two/);
    await git.call(["mv","--","selected.txt","فایل.txt"]);
    assert.match((await git.diff("فایل.txt")).staged,/rename from selected.txt/);
    await git.action({action:"commit",message:"Rename selected file",paths:["فایل.txt"]});
    assert.equal((await git.call(["show","HEAD:فایل.txt"])).output,"two\n");
    assert.notEqual((await git.call(["cat-file","-e","HEAD:selected.txt"],{allowFailure:true})).code,0);
    assert((await git.status()).files.some(f=>f.path==="other.txt"&&f.status.startsWith("A")));
    await writeFile(join(root,'fresh.txt'),'fresh preview\n');
    assert.match((await git.diff('fresh.txt')).untracked,/\+fresh preview/);
    await writeFile(join(root,'selected-stage.txt'),'base\n');await git.action({action:'commit',message:'Fixture base',paths:['selected-stage.txt']});
    await writeFile(join(root,'selected-stage.txt'),'staged\n');await git.call(['add','--','selected-stage.txt']);await writeFile(join(root,'selected-stage.txt'),'working\n');
    const both=await git.diff('selected-stage.txt');assert.match(both.staged,/\+staged/);assert.match(both.worktree,/\+working/);
    assert.match(both.text,/\+staged/);assert.match(both.text,/\+working/);
    await assert.rejects(git.diff('.env'));
    await assert.rejects(git.diff("../outside"));
    await mkdir(join(root,"nested"));await assert.rejects(new WorkspaceGit(join(root,"nested")).status(),/ریشه/);
  }finally{if(ceiling===undefined)delete process.env.GIT_CEILING_DIRECTORIES;else process.env.GIT_CEILING_DIRECTORIES=ceiling;assert(root.startsWith(join(await realpath(tmpdir()),"paastacode-git-")));await rm(root,{recursive:true,force:true});}
});
