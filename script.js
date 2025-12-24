document.addEventListener('DOMContentLoaded', () => {
    initChineseConverter();
    initExchangeRateTable();
    initHistory();
    initSmartConverter();
});

// ==========================================
// 全局汇率状态
// ==========================================
const FALLBACK_RATES = {
    "CNY": 1,
    "USD": 0.138,
    "EUR": 0.127,
    "GBP": 0.109,
    "JPY": 21.5,
    "HKD": 1.08,
    "RUB": 13.5
};

let currentRates = { ...FALLBACK_RATES };
let lastUpdateTime = null;
let currentBase = 'CNY';

// 全局汇率获取函数
async function fetchGlobalRates(base) {
    // 如果已经有缓存且 base 相同且时间在 1 小时内，直接返回
    if (base === currentBase && lastUpdateTime && (new Date() - lastUpdateTime < 3600000)) {
        return true;
    }

    try {
        const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        currentRates = data.rates;
        lastUpdateTime = new Date(data.time_last_updated * 1000);
        currentBase = base;
        
        // 更新页面上的汇率时间（如果在汇率模块）
        const updateTimeEl = document.getElementById('update-time');
        if (updateTimeEl) {
            updateTimeEl.textContent = '更新时间: ' + lastUpdateTime.toLocaleString();
        }
        return true;
    } catch (error) {
        console.warn('API调用失败，使用兜底汇率', error);
        // 如果失败，回退到默认
        if (base === 'CNY') {
            currentRates = { ...FALLBACK_RATES };
            currentBase = 'CNY';
        }
        return false;
    }
}

// ==========================================
// 模块0：智能识别转换
// ==========================================
function initSmartConverter() {
    const input = document.getElementById('smart-input');
    const unitSelect = document.getElementById('smart-unit');
    const sourceSelect = document.getElementById('smart-source-currency');
    const targetSelect = document.getElementById('smart-target');
    const targetUnitSelect = document.getElementById('smart-target-unit');
    const mainResult = document.getElementById('smart-main-result');
    const subResult = document.getElementById('smart-sub-result');
    const readingBox = document.querySelector('.smart-reading');
    const sourceReadingEl = document.getElementById('smart-source-reading');
    const targetReadingEl = document.getElementById('smart-target-reading');
    const rateDisplayEl = document.getElementById('smart-rate-display');

    const handleInput = () => {
        processSmartInput();
    };

    // 添加保存记录功能
    const saveBtn = document.getElementById('save-smart-record');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            saveSmartRecord();
        });
    }

    input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') handleInput();
    });
    
    // 增加防抖输入监听
    let timeout;
    input.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(handleInput, 800);
    });

    // 下拉框改变立即触发
    if (unitSelect) unitSelect.addEventListener('change', handleInput);
    if (sourceSelect) sourceSelect.addEventListener('change', handleInput);
    if (targetSelect) targetSelect.addEventListener('change', handleInput);
    if (targetUnitSelect) targetUnitSelect.addEventListener('change', handleInput);

    // 保存当前智能转换记录到历史
    function saveSmartRecord() {
        const text = input.value.trim();
        if (!text || mainResult.textContent === '--' || mainResult.textContent === '无法识别') {
            alert('请先输入有效内容并完成转换');
            return;
        }

        // 获取当前源和目标信息
        const sourceCurrency = sourceSelect.value;
        const targetCurrency = targetSelect.value;
        const unitMultiplier = parseFloat(unitSelect.value) || 1;
        const targetMultiplier = parseFloat(targetUnitSelect.value) || 1;
        
        // 解析输入数据
        const parsed = parseInput(text);
        if (!parsed) return;
        
        // 计算最终金额
        const finalSourceAmount = parsed.amount * unitMultiplier;
        
        // 获取结果金额
        const resultText = mainResult.textContent;
        const resultNumber = parseFloat(resultText.replace(/,/g, ''));
        const finalResultAmount = resultNumber * targetMultiplier;
        
        // 创建记录对象
        const record = {
            amount: finalSourceAmount,
            from: sourceCurrency,
            to: targetCurrency,
            result: formatCurrency(finalResultAmount, targetCurrency),
            timestamp: Date.now()
        };
        
        // 保存到历史记录
        addHistory(record);
        
        // 显示保存成功提示
        const saveBtn = document.getElementById('save-smart-record');
        if (saveBtn) {
            const originalText = saveBtn.textContent;
            saveBtn.textContent = '已保存！';
            setTimeout(() => saveBtn.textContent = originalText, 1500);
        }
    }

    async function processSmartInput() {
        const text = input.value.trim();
        if (!text) {
            mainResult.textContent = '--';
            subResult.textContent = '输入内容自动识别中...';
            // 恢复默认占位符
            if (sourceReadingEl) sourceReadingEl.innerHTML = '<span style="color:#94a3b8">等待输入...</span>';
            if (targetReadingEl) targetReadingEl.innerHTML = '<span style="color:#94a3b8">等待输入...</span>';
            if (rateDisplayEl) rateDisplayEl.innerHTML = '<span style="color:#64748b">当前汇率：</span>--';
            return;
        }

        const parsed = parseInput(text);
        if (!parsed) {
            mainResult.textContent = '无法识别';
            return;
        }

        // 自动同步单位下拉框：如果解析出了单位，就自动选中，并重置 parsed.amount 为原始数字
        if (parsed.detectedUnit > 1 && unitSelect) {
            // 尝试在下拉框中找到对应的值
            const options = Array.from(unitSelect.options).map(o => parseFloat(o.value));
            if (options.includes(parsed.detectedUnit)) {
                unitSelect.value = parsed.detectedUnit;
            }
        }

        // 确定源币种：如果输入中包含币种，优先使用；否则使用下拉框
        let sourceCurrency = parsed.currencyCode;
        if (sourceCurrency) {
            // 同步下拉框
            if (sourceSelect && sourceSelect.value !== sourceCurrency) {
                // 检查下拉框是否有该值（避免错误）
                const options = Array.from(sourceSelect.options).map(o => o.value);
                if (options.includes(sourceCurrency)) {
                    sourceSelect.value = sourceCurrency;
                }
            }
        } else {
            // 使用下拉框的值
            sourceCurrency = sourceSelect ? sourceSelect.value : 'CNY';
        }

        // 应用源单位倍率 (统一使用下拉框的值)
        // 注意：parseInput 返回的 amount 是原始数字，没有乘倍率
        const unitMultiplier = unitSelect ? (parseFloat(unitSelect.value) || 1) : 1;
        const finalSourceAmount = parsed.amount * unitMultiplier;
        
        // 获取目标币种
        const targetCurrency = targetSelect ? targetSelect.value : (sourceCurrency === 'CNY' ? 'USD' : 'CNY');
        
        // 获取目标单位倍率
        const targetMultiplier = targetUnitSelect ? (parseFloat(targetUnitSelect.value) || 1) : 1;
        
        // 构建调试/辅助信息
        let unitText = '';
        if (unitMultiplier > 1 && unitSelect) {
            unitText = unitSelect.options[unitSelect.selectedIndex].text;
        }
        
        subResult.textContent = `识别为：${parsed.amount}${unitText} ${sourceCurrency}`;
        
        let rateSource = currentRates[sourceCurrency];
        let rateTarget = currentRates[targetCurrency];
        
        if (currentBase === sourceCurrency) rateSource = 1;
        
        if (!rateSource || !rateTarget) {
            await fetchGlobalRates('CNY');
            rateSource = currentRates[sourceCurrency];
            rateTarget = currentRates[targetCurrency];
        }
        
        if (rateSource && rateTarget) {
            const baseResult = (finalSourceAmount / rateSource) * rateTarget;
            const finalResult = baseResult / targetMultiplier;
            
            // 显示结果
            if (targetMultiplier > 1) {
                mainResult.textContent = new Intl.NumberFormat('zh-CN', { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 4 
                }).format(finalResult);
            } else {
                mainResult.textContent = formatCurrency(finalResult, targetCurrency);
            }
            
            // 只有当目标单位和源单位不一样，或者有倍率时，才显示辅助信息，否则太冗余
            let targetUnitText = '';
             if (targetMultiplier > 1 && targetUnitSelect) {
                targetUnitText = targetUnitSelect.options[targetUnitSelect.selectedIndex].text;
            }
            subResult.textContent += ` -> ${mainResult.textContent} ${targetUnitText}${targetCurrency}`;
            
            // 显示汇率参考
            const exchangeRate = rateTarget / rateSource;
            // 为了符合用户习惯，如果数值小于1 (如 CNY->USD = 0.14)，则显示反向汇率 (1 USD = 7.x CNY)
            let rateText = '';
            if (exchangeRate < 1 && exchangeRate > 0) {
                 rateText = `1 ${targetCurrency} ≈ ${(1/exchangeRate).toFixed(4)} ${sourceCurrency}`;
                 subResult.textContent += `  (${rateText})`;
            } else {
                 rateText = `1 ${sourceCurrency} ≈ ${exchangeRate.toFixed(4)} ${targetCurrency}`;
                 subResult.textContent += `  (${rateText})`;
            }

            // 新增：显示标准读法
            if (readingBox && sourceReadingEl && targetReadingEl) {
                const getCurrencyName = (code, selectElement) => {
                    let name = code;
                    if (selectElement) {
                        const opt = Array.from(selectElement.options).find(o => o.value === code);
                        if (opt) {
                            const parts = opt.text.split(' - ');
                            if (parts.length > 1) name = parts[1];
                        }
                    }
                    if (name.includes('俄币')) name = '卢布';
                    return name;
                };

                const sourceName = getCurrencyName(sourceCurrency, sourceSelect);
                const targetName = getCurrencyName(targetCurrency, targetSelect);

                // 辅助函数：生成标准读法
                const getStandardReading = (num, cName) => {
                    // 确保传入的是数字类型
                    num = parseFloat(num);
                    if (isNaN(num)) return '无法计算';

                    let r = digitToChinese(num);
                    if (r.includes('数据非法') || r.includes('金额过大')) return r;
                    
                    if (cName === '人民币' || cName === 'CNY') return r;
                    
                    // 替换单位
                    r = r.replace(/整$/g, '');
                    r = r.replace(/元/g, cName);
                    return r;
                };

                sourceReadingEl.innerHTML = `<span style="color:#64748b; font-size:0.9em;">源金额 (${sourceName})：</span><br>${getStandardReading(finalSourceAmount, sourceName)}`;
                targetReadingEl.innerHTML = `<span style="color:#64748b; font-size:0.9em;">换算后 (${targetName})：</span><br>${getStandardReading(baseResult, targetName)}`;
                
                // 更新实时汇率显示
                if (rateDisplayEl) {
                     rateDisplayEl.innerHTML = `<span style="color:#64748b">当前汇率：</span>${rateText} <span style="color:#94a3b8; font-size:0.85em; margin-left:8px;">(实时更新)</span>`;
                }
            }

        } else {
            subResult.textContent = '暂无该币种汇率数据';
            // 保持框显示，但提示无数据
             if (sourceReadingEl) sourceReadingEl.innerHTML = '<span style="color:#94a3b8">等待输入...</span>';
             if (targetReadingEl) targetReadingEl.innerHTML = '<span style="color:#94a3b8">等待输入...</span>';
             if (rateDisplayEl) rateDisplayEl.innerHTML = '<span style="color:#64748b">当前汇率：</span>暂无数据';
        }
    }
}

function parseInput(text) {
    // 1. 提取数字
    // 支持 1,000.50 或 1000.50
    const numMatch = text.match(/([\d,]+(\.\d+)?)/);
    if (!numMatch) return null;
    
    let rawNumStr = numMatch[1].replace(/,/g, '');
    let amount = parseFloat(rawNumStr);
    
    // 2. 提取单位 (万/亿)
    // 简单的倍率处理
    let detectedUnit = 1;
    if (text.includes('亿')) {
        detectedUnit = 100000000;
    } else if (text.includes('万')) {
        detectedUnit = 10000;
    }
    
    // 注意：这里不再直接乘倍率，而是返回 detectedUnit 供外部同步 UI
    // amount = amount * multiplier; 
    
    // 3. 提取币种
    let currencyCode = null; // 默认不指定，由下拉框决定
    let currencyName = '';
    
    // 币种映射表
    const map = [
        { keys: ['美元', '美金', '刀', 'USD', '$'], code: 'USD', name: '美元' },
        { keys: ['人民币', '元', '块', 'CNY', 'RMB', '¥'], code: 'CNY', name: '人民币' },
        { keys: ['欧元', 'EUR', '€'], code: 'EUR', name: '欧元' },
        { keys: ['英镑', 'GBP', '£'], code: 'GBP', name: '英镑' },
        { keys: ['日元', 'JPY'], code: 'JPY', name: '日元' },
        { keys: ['港币', '港元', 'HKD'], code: 'HKD', name: '港币' },
        { keys: ['卢布', '俄币', 'RUB', '₽'], code: 'RUB', name: '俄币' },
    ];
    
    // 简单的匹配逻辑：查找 text 中是否包含 key
    // 为了防止“美元”包含“元”，应该优先匹配长词，或者按顺序匹配
    let found = false;
    for (const item of map) {
        for (const key of item.keys) {
            // 忽略大小写
            if (text.toLowerCase().includes(key.toLowerCase())) {
                // 特殊处理：如果匹配到“元”，但前面有“美”、“日”、“欧”等，则不应该单独匹配“元”
                // 简单起见，我们假设 map 的顺序已经把特殊的放在前面了？
                // 比如“美元”在“元”之前。
                // 但是 text.includes 无法区分位置。
                // 比如 "100美元" includes "元" is true.
                
                // 更严谨的方法：把匹配到的关键词从 text 中剔除，看剩余的是否符合
                // 或者直接以最先匹配到的为准（Map 顺序很重要）
                
                // 改进：使用正则匹配边界或特定关键词
                currencyCode = item.code;
                currencyName = item.name;
                found = true;
                break;
            }
        }
        if (found) break;
    }
    
    // 如果包含“美元”，它同时也包含“元”。
    // 上面的循环：先检查 USD (含 美元)。如果 text 是 "100美元"，匹配到 USD 组，found=true，break。
    // 此时不会进入 CNY 组 (含 元)。
    // 逻辑是成立的，只要 USD 在 CNY 前面。
    
    return {
        amount,
        detectedUnit, // 新增
        amountText: rawNumStr, // 修改：不再包含倍率后缀，只返回原始数字文本
        currencyCode,
        currencyName
    };
}


// ==========================================
// 模块1：中文大写金额
// ==========================================
function initChineseConverter() {
    const input = document.getElementById('amount-cn');
    const resultBox = document.getElementById('result-cn');
    const copyBtn = document.getElementById('copy-cn');

    input.addEventListener('input', (e) => {
        const value = e.target.value;
        if (!value) {
            resultBox.innerHTML = '<span class="placeholder">等待输入...</span>';
            return;
        }
        const chinese = digitToChinese(value);
        resultBox.textContent = chinese;
    });

    copyBtn.addEventListener('click', () => {
        const text = resultBox.textContent;
        if (text && text !== '等待输入...') {
            navigator.clipboard.writeText(text).then(() => {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '已复制！';
                setTimeout(() => copyBtn.textContent = originalText, 1500);
            });
        }
    });
}

function digitToChinese(n) {
    if (n === "") return "";
    // 处理非法字符
    if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(n)) return "数据非法";

    // 转换为浮点数处理精度，再转回字符串
    let num = parseFloat(n);
    if (isNaN(num)) return "数据非法";
    if (num === 0) return "零元整";
    if (num >= 1000000000000) return "金额过大（超过千亿）";

    let unit = "仟佰拾亿仟佰拾万仟佰拾元角分";
    let str = "";
    
    // 乘100四舍五入，转为整数分
    // 注意：直接 *100 可能会有精度问题，如 1.12 * 100 = 112.00000000000001
    // 使用 Math.round 解决
    let pStr = Math.round(num * 100).toString();
    
    // 补齐长度，确保至少匹配到分
    // 如果是 0.1 -> 10 分。 unit 应匹配 "角分"
    
    if (pStr.length > unit.length) return "金额过大";
    
    // 截取对应的单位
    let currentUnit = unit.substr(unit.length - pStr.length);
    
    for (let i = 0; i < pStr.length; i++) {
        str += '零壹贰叁肆伍陆柒捌玖'.charAt(pStr.charAt(i)) + currentUnit.charAt(i);
    }
    
    return str.replace(/零(仟|佰|拾|角)/g, "零")
        .replace(/(零)+/g, "零")
        .replace(/零(万|亿|元)/g, "$1")
        .replace(/(亿)万/g, "$1")
        .replace(/^元零?|零分/g, "")
        .replace(/元$/g, "元整");
}

// ==========================================
// 模块2：各国汇率浮动表
// ==========================================
function initExchangeRateTable() {
    const baseSelect = document.getElementById('base-currency-select');
    const refreshBtn = document.getElementById('refresh-table-btn');
    const tableBody = document.getElementById('rate-table-body');
    const updateTimeEl = document.getElementById('table-update-time');

    const CURRENCY_CONFIG = {
        "CNY": { name: "人民币", flag: "🇨🇳" },
        "USD": { name: "美元", flag: "🇺🇸" },
        "EUR": { name: "欧元", flag: "🇪🇺" },
        "GBP": { name: "英镑", flag: "🇬🇧" },
        "JPY": { name: "日元", flag: "🇯🇵" },
        "HKD": { name: "港币", flag: "🇭🇰" },
        "RUB": { name: "卢布", flag: "🇷🇺" },
        "KRW": { name: "韩元", flag: "🇰🇷" },
        "AUD": { name: "澳元", flag: "🇦🇺" },
        "CAD": { name: "加元", flag: "🇨🇦" },
        "SGD": { name: "新加坡元", flag: "🇸🇬" },
        "THB": { name: "泰铢", flag: "🇹🇭" }
    };
    
    const DISPLAY_LIST = Object.keys(CURRENCY_CONFIG);

    // 初始化加载
    loadData();

    async function loadData() {
        const base = baseSelect.value;
        setLoadingState(true);
        
        // 尝试获取数据
        const success = await fetchGlobalRates(base);
        
        if (success) {
            renderTable();
        } else {
            // 如果获取失败
            if (currentBase !== base) {
                // 如果切换币种失败，回退下拉框显示
                alert(`获取 ${base} 汇率失败，请检查网络。`);
                baseSelect.value = currentBase;
                renderTable();
            } else {
                // 如果是当前币种刷新失败（可能使用了缓存或兜底），依然渲染
                renderTable();
            }
        }
        
        setLoadingState(false);
    }

    function renderTable() {
        const base = baseSelect.value;
        tableBody.innerHTML = '';
        
        // 更新时间显示
        if (lastUpdateTime && updateTimeEl) {
            updateTimeEl.textContent = '更新时间: ' + lastUpdateTime.toLocaleString();
        }

        DISPLAY_LIST.forEach(code => {
            if (code === base) return; // 不显示基准货币自己

            const rate = currentRates[code];
            if (!rate) return;

            const tr = document.createElement('tr');
            
            // 币种列
            const config = CURRENCY_CONFIG[code] || { name: code, flag: '🌐' };
            const cellCurrency = `
                <div class="currency-cell">
                    <span class="flag-icon">${config.flag}</span>
                    <div>
                        <div>${code}</div>
                        <div class="currency-name">${config.name}</div>
                    </div>
                </div>
            `;

            // 汇率列 (1 Base = ? Target)
            const cellRate = `<div class="rate-value">${rate.toFixed(4)}</div>`;

            // 换算列 (100 Base = ? Target)
            const amount100 = (rate * 100).toFixed(2);
            const cellAmount = `<div class="rate-value">${amount100}</div>`;

            tr.innerHTML = `
                <td>${cellCurrency}</td>
                <td>${cellRate}</td>
                <td>${cellAmount}</td>
            `;
            
            tableBody.appendChild(tr);
        });
    }

    function setLoadingState(loading) {
        if (loading) {
            refreshBtn.textContent = '...';
            refreshBtn.disabled = true;
            tableBody.style.opacity = '0.5';
        } else {
            refreshBtn.textContent = '↻ 刷新';
            refreshBtn.disabled = false;
            tableBody.style.opacity = '1';
        }
    }

    // 事件监听
    if (baseSelect) baseSelect.addEventListener('change', loadData);
    
    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
        lastUpdateTime = null; // Force refresh
        await loadData();
    });
}

function formatCurrency(num, currency) {
    return new Intl.NumberFormat('zh-CN', { 
        style: 'currency', 
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

// ==========================================
// 模块3：历史记录
// ==========================================
function initHistory() {
    renderHistory();
    
    const clearBtn = document.getElementById('clear-history');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            localStorage.removeItem('conversionHistory');
            renderHistory();
        });
    }
}

function getHistory() {
    const history = localStorage.getItem('conversionHistory');
    return history ? JSON.parse(history) : [];
}

function addHistory(record) {
    const history = getHistory();
    history.unshift(record);
    if (history.length > 10) {
        history.pop();
    }
    localStorage.setItem('conversionHistory', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    
    const history = getHistory();
    
    list.innerHTML = '';
    
    if (history.length === 0) {
        list.innerHTML = '<li class="empty-tip">暂无记录</li>';
        return;
    }

    history.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
            <div class="history-content">
                <span class="history-main">${formatCurrency(item.amount, item.from)} ➔ ${item.result}</span>
                <span class="history-sub">${new Date(item.timestamp).toLocaleString()}</span>
            </div>
            <div class="history-arrow">↺</div>
        `;
        
        li.addEventListener('click', () => {
            restoreHistory(item);
        });
        
        list.appendChild(li);
    });
}

function restoreHistory(item) {
    const amountEl = document.getElementById('amount-ex');
    const fromEl = document.getElementById('currency-from');
    const toEl = document.getElementById('currency-to');
    
    if (amountEl && fromEl && toEl) {
        amountEl.value = item.amount;
        fromEl.value = item.from;
        toEl.value = item.to;
        fromEl.dispatchEvent(new Event('change'));
    }
}
