const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else {
            if (file.endsWith('.ts') || file.endsWith('.tsx')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk('e:\\QRDine\\frontend\\src');
let changedCount = 0;

files.forEach(file => {
    let original = fs.readFileSync(file, 'utf8');
    let content = original;
    
    // Replace "/admin..." with "/cafe..."
    content = content.replace(/(["'`])\/admin(?=\/|["'`])/g, '$1/cafe');

    // Replace "/superadmin..." with "/admin..."
    content = content.replace(/(["'`])\/superadmin(?=\/|["'`])/g, '$1/admin');

    // Replace "/signup..." with "/cafe/signup..."
    content = content.replace(/(["'`])\/signup(?=\/|["'`])/g, '$1/cafe/signup');

    if (content !== original) {
        fs.writeFileSync(file, content, 'utf8');
        changedCount++;
    }
});

console.log(`Updated ${changedCount} files.`);
