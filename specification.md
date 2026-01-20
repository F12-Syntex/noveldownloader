a interactive cli program, that lets the user download novels into formats such as epub or pdf, we download chapter by chapter from novelfull.

here is the pipline

main menu contains downloads, download new, and export

if downloads, we simply show them all the current downloads and how many chapters etc were downlaoded

if download new 
we request the user to input a name
we then query the name

https://novelfull.net/search?keyword=query

we show the user the options, they then select from a dropdown in the cli for the novel to download

once downloaded from lets say 

https://novelfull.net/rebirth-of-the-thief-who-roamed-the-world.html

we download each chapter one by one, saving to data/%name%/meta.json data/%name%/chapters/chapter%num%.txt
data/%name%/meta.json contains information such as 
and cover.png
Novel info
Rebirth of the Thief Who Roamed the World
Author:Mad Snail, 发飙的蜗牛
Genre:Action, Adventure, Fantasy, Romance, School Life, Slice of Life, Wuxia
Source:LittleShanks Translations
Status:Completed
Rebirth of the Thief Who Roamed the World
Rating: 8.5/10 from 3415 ratings
The world’s largest VRMMO, Conviction, was almost like a second world for humanity. It had integrated itself into the real world’s economy, with both corporations and individuals seeking their fortunes through the game.

In this game, Nie Yan prided himself in his Level 180 Thief. He could barely be considered among the top experts in the game. Though, that was the only thing he could take pride in. He was penniless and unable to advance in life; a situation he was forced into by the enemy of his father. If it weren’t for the little money he made by selling off items in Conviction, he would’ve barely been able to eat. In the end, he chose to settle his matters once and for all. He assassinated his father’s enemy. He lay dying shortly after being shot in the pursuit.

However, that wasn’t the end of his story. Instead, he awoke moments later to find that he had reincarnated into his past-self. Armed with his experience and knowledge of future events, he sets out to live his life anew.

if export, we show them the downloaded contents, and let them pick one then ask to export as pdf or epub


technical notes
1: we must be very sophesticated and have expert level logs, ensure everything logged properly, in addition lets suppose a chapter download fails, please mark it as failed in downloads we need to retry failed downloads in the end, and remember clealry chapttesr that are missing 
