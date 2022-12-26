const path = require('path');
const {app, BrowserWindow, Menu, ipcMain, dialog, shell, Tray } = require('electron')
const XLSX = require('xlsx');
const sd = require('silly-datetime');
const fs = require('fs');
const ini = require('ini');

let classChosen = new Map(), studentAttend = new Set();

let excelFile = null, classSheetMap = new Map(), filePath = '', win = null;

let closeToTray = true;

let config = null;

async function creatSonWindow(father, name, width = undefined, height = undefined) {
    const sonWindow = new BrowserWindow({
        width: width,
        height: height,
        parent: father,
        webPreferences: {
            preload: path.join(__dirname, 'preload/' + name + '.js'),
        },
        show: false,
    });
    const menu = Menu.buildFromTemplate([
    {
        label: app.name,
        submenu: [
        {
            click: () => shell.openExternal('https://github.com/Tianyuan-College/online-class-helper'),
            label: 'Github',
        },
        {
            click: () => sonWindow.webContents.openDevTools(),
            label: '开发者工具',
        }
        ]
    }
    ]);
    sonWindow.setMenu(menu);
    sonWindow.loadFile('src/html/' + name + '.html');
    sonWindow.once('ready-to-show', () => {
        sonWindow.setIcon(path.join(__dirname, '../images/icon.png'));
        sonWindow.show();
    })
}

function parseExcel(init = false) {
    classChosen.clear(); studentAttend.clear(); classSheetMap.clear();
    excelFile = XLSX.readFile(filePath);

    for (const sheetName of excelFile.SheetNames) {
        const sheetAoa = XLSX.utils.sheet_to_json(excelFile.Sheets[sheetName], {header: 1});
        classSheetMap.set(sheetName, sheetAoa);
        for (const lst of sheetAoa) if (lst[0] !== '姓名') {
            studentAttend.add(lst[0]);
        }
        classChosen.set(sheetName, false);
    }

    //显示文件读取成功
    win.webContents.send('setFile', excelFile.SheetNames, path.basename(filePath), classChosen);
}

function initIni() {
    let tmpFile = null;
    try {
        tmpFile = fs.readFileSync('./config.ini', 'utf-8');
    } catch {
        fs.writeFileSync('./config.ini', '');
        tmpFile = fs.readFileSync('./config.ini', 'utf-8');
    }
    config = ini.parse(tmpFile);
    //Tray的构建依赖于closeToTray
    if (config.closeToTray !== undefined) {
        closeToTray = config.closeToTray;
    }
}

function writeFiles() {
    let tmp = excelFile.SheetNames;
    tmp.sort();
    config.classChosen = [];
    for (const name of tmp) {
        config.classChosen.push(classChosen.get(name));
    }
    config.closeToTray = closeToTray;
    fs.writeFileSync('./config.ini', ini.stringify(config));
    XLSX.writeFile(excelFile, filePath, {bookType: path.extname(filePath).substring(1)});
}

const creatStatusWindow = () => {
    win = new BrowserWindow({
        width: 600,
        height: 500,
        webPreferences: {
            preload: path.join(__dirname, 'preload/status.js'),
        },
        show: false,
    });

    const menu = Menu.buildFromTemplate([
    {
        label: app.name,
        submenu: [
        {
            click: () => shell.openExternal('https://github.com/Tianyuan-College/online-class-helper'),
            label: 'Github',
        },
        {
            click: () => win.webContents.openDevTools(),
            label: '开发者工具',
        }
        ]
    },
    {
        label: '名单',
        submenu: [
        {
            click: async () => {
                const { canceled, filePaths } = await dialog.showOpenDialog({
                    properties: ['openFile'],
                    filters: [{ name: 'Excel文件', extensions: ['xlsx', 'xls', 'ods']}]
                });
                if (!canceled && filePaths[0] != filePath) {
                    filePath = filePaths[0];
                    config.filePath = filePaths[0];
                    parseExcel();
                }
            },
            label: '选择名单',
        }
        ]
    },
    {
        label: '功能',
        submenu: [
        {
            label: '签到',
            click: async () => {
                if (excelFile === null) {
                    await dialog.showMessageBox({message: '请先选择Excel名单'});
                } else {
                    creatSonWindow(win, 'check');
                }
            },
        },
        {
            label: '随机点名',
            click: async () => {
                if (excelFile === null) {
                    await dialog.showMessageBox({message: '请先选择Excel名单'});
                }
                else {
                    creatSonWindow(win, 'rand-name', 400, 250);
                }
            },
        },
        {
            label: '倒计时',
            click: () => creatSonWindow(win, 'remain-time', 400, 250),
        }
        ]
    }
    ])
    Menu.setApplicationMenu(menu);

    win.loadFile('src/html/status.html');

    win.once('ready-to-show', () => {
        win.show();
        win.setIcon(path.join(__dirname, '../images/icon.png'));

        if (config.filePath) {
            filePath = config.filePath;
            parseExcel();
            let tmp = excelFile.SheetNames;
            tmp.sort();
            for (const i in tmp) {
                classChosen.set(tmp[i], config.classChosen[i]);
            }
            win.webContents.send('setFile', excelFile.SheetNames, path.basename(filePath), classChosen);
        }
    });

    //托盘事件
    //也可以监听 app 中的 'will-quit' ，但是那样需要在重新启动的时候新建窗口
    win.on('close', (event) => {
        if (closeToTray) {
            event.preventDefault();
            win.setSkipTaskbar(true);
            win.hide();
        }
    });
}

app.whenReady().then(() => {
    creatStatusWindow();
    initIni();

    let tray = new Tray(path.join(__dirname, '../images/icon.png'));
    tray.setContextMenu(Menu.buildFromTemplate([
    {
        label: '打开',
        click: () => {
            win.show();
            win.setSkipTaskbar(false);
        },
    },
    {
        label: '退出',
        click: () => {
            writeFiles();
            app.exit();
        }
    },
    {
        label: '最小化到托盘',
        type: 'checkbox',
        checked: closeToTray,
        click: () => closeToTray = !closeToTray,
    }
    ]))

    ipcMain.on('changeClass', (event, className, checked) => {
        classChosen.set(className, checked);
    });

    ipcMain.handle('randStudent', async (event) => {
        if (studentAttend.size === 0) {
            dialog.showMessageBox({message: '哎呀！没有人在听课！请查看班级是否选择正确，然后尝试重新签到。'});
            return '咕咕咕';
        } else {
            const tmp = Array.from(studentAttend);
            return tmp[Math.floor(tmp.length * Math.random())];
        }
    });

    ipcMain.handle('checkStudent', async (event, checkInfo) => {
        absentList = [];
        for (const className of excelFile.SheetNames) if (classChosen.get(className)) {
            //注意tmp是Map元素的引用
            tmp = classSheetMap.get(className);
            for (let i in tmp) if (tmp[i][0] !== '姓名') {
                if (checkInfo.indexOf(tmp[i][0]) === -1) {
                    studentAttend.delete(tmp[i][0]);
                    absentList.push(tmp[i][0]);
                    tmp[i].push('未到');
                } else {
                    studentAttend.add(tmp[i][0]);
                    tmp[i].push('已到');
                }
            } else {
                tmp[i].push(sd.format(new Date(), 'MM-DD HH:mm'));
            }
            excelFile.Sheets[className] = XLSX.utils.aoa_to_sheet(tmp);
        }
        return absentList;
    });

    ipcMain.on('timeIsUp', (event) => {
        dialog.showMessageBox({message: '倒计时结束！'});
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createStatusWindow();
        }
    });

    app.on('quit', (event, exitCode) => {

    })
});
