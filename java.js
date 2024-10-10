const toggleBalanceBtn = document.getElementById('toggleBalance');
const balanceDisplay = document.getElementById('balance');

// Replace this with the actual balance
let actualBalance = "1000.00"; // Example balance

toggleBalanceBtn.addEventListener('click', () => {
    if (balanceDisplay.innerText === '*****') {
        balanceDisplay.innerText = actualBalance;
    } else {
        balanceDisplay.innerText = '*****';
    }
});